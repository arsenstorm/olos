import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { CommittedPart } from "../types/committed-window";
import type { Cursor } from "../types/cursor";
import { nextPartCovering, resolveCommittedParts } from "./byterange-parts";
import {
  type ByterangeCursorWait,
  type ByterangeRangeRequest,
  type CreateByterangeSegmentResponseOptions,
  DEFAULT_CURSOR_WAIT_TIMEOUT_MS,
  type ResolvedByterangeParts,
} from "./byterange-types";

/** Position the drain has reached, and the window it is reading from. */
interface ByterangeStreamState {
  cursor: Cursor;
  parts: CommittedPart[];
  position: number;
}

/**
 * Everything the drain needs that does not change as it advances. Bundled so
 * the pump helpers take the context plus the one value they act on, rather
 * than threading six positional arguments through every call.
 */
interface ByterangeStreamContext {
  controller: ReadableStreamDefaultController<Uint8Array>;
  options: CreateByterangeSegmentResponseOptions;
  range: ByterangeRangeRequest;
  signal: AbortSignal;
  timeoutMs: number;
}

/**
 * Structural view of the part body reader. The SDK body carries the DOM
 * reader type rather than Bun's, so it is described by shape instead of by
 * name. `read()` keeps its discriminated result so `done` narrows `value`.
 */
interface PartBodyReader {
  cancel(): Promise<unknown>;
  read(): Promise<
    { done: false; value: Uint8Array } | { done: true; value?: undefined }
  >;
}

/**
 * Stream the requested range of a virtual segment, blocking on the cursor
 * whenever the range runs past the bytes committed so far.
 */
export function createByterangeStream(
  options: CreateByterangeSegmentResponseOptions,
  initial: ResolvedByterangeParts,
  range: ByterangeRangeRequest
): ReadableStream<Uint8Array> {
  const state: ByterangeStreamState = {
    cursor: initial.cursor,
    parts: initial.parts,
    position: range.start,
  };
  // One signal covers both termination paths: the viewer disconnecting
  // (`options.signal`) and the consumer cancelling the response body.
  const abort = linkAbort(options.signal);

  return new ReadableStream<Uint8Array>({
    pull: (controller) =>
      pullByterange(
        {
          controller,
          options,
          range,
          signal: abort.signal,
          timeoutMs: options.timeoutMs ?? DEFAULT_CURSOR_WAIT_TIMEOUT_MS,
        },
        state,
        abort
      ),
    cancel() {
      // Consumer cancelled the body. Abort so in-flight S3 part reads and
      // cursor waits release instead of holding their sockets open.
      abort.abort();
    },
  });
}

async function pullByterange(
  context: ByterangeStreamContext,
  state: ByterangeStreamState,
  abort: LinkedAbort
): Promise<void> {
  try {
    await drainByterange(context, state);
    context.controller.close();
  } catch (error) {
    // After an abort the stream is already dead; erroring it would only
    // produce noise (and `close()` throws once the consumer cancels).
    if (!abort.signal.aborted) {
      context.controller.error(error);
    }
  } finally {
    abort.release();
  }
}

interface LinkedAbort {
  abort: () => void;
  release: () => void;
  signal: AbortSignal;
}

/** An abort controller that also fires when `outer` aborts. */
function linkAbort(outer: AbortSignal | undefined): LinkedAbort {
  const controller = new AbortController();
  const abort = () => controller.abort();

  if (outer === undefined) {
    return { abort, release: noop, signal: controller.signal };
  }
  if (outer.aborted) {
    controller.abort();
    return { abort, release: noop, signal: controller.signal };
  }

  outer.addEventListener("abort", abort, { once: true });
  return {
    abort,
    release: () => outer.removeEventListener("abort", abort),
    signal: controller.signal,
  };
}

function noop(): void {
  // No listener was registered, so there is nothing to release.
}

/**
 * Walk forward through the committed parts, enqueuing bytes until the range
 * is satisfied, the cursor stops advancing, or the viewer goes away.
 */
async function drainByterange(
  context: ByterangeStreamContext,
  state: ByterangeStreamState
): Promise<void> {
  const { range, signal } = context;

  while (range.end === undefined || state.position <= range.end) {
    if (signal.aborted) {
      return;
    }

    const next = nextPartCovering(state.parts, state.position);
    if (next !== undefined) {
      state.position += await streamPartForward(context, next, state.position);
      continue;
    }

    if (await advanceCursor(context, state)) {
      continue;
    }

    assertBoundedRangeSatisfied(context, state);
    return;
  }
}

async function streamPartForward(
  context: ByterangeStreamContext,
  part: CommittedPart,
  position: number
): Promise<number> {
  const written = await streamPart(context, part, position);
  if (written === 0) {
    // `streamPart` throws before returning 0; guard against regressions that
    // would otherwise spin the drain loop forever on the same part.
    throw new Error("byterange stream made no forward progress");
  }
  return written;
}

function assertBoundedRangeSatisfied(
  context: ByterangeStreamContext,
  state: ByterangeStreamState
): void {
  if (context.range.end !== undefined && state.position <= context.range.end) {
    // A bounded response already promised `content-length`; erroring the
    // stream surfaces an aborted transfer instead of a silently short 206.
    throw new Error("byterange stream ended before requested end");
  }
}

/** Re-read the window after the cursor advances. False means no new bytes. */
async function advanceCursor(
  context: ByterangeStreamContext,
  state: ByterangeStreamState
): Promise<boolean> {
  const { options } = context;
  if (options.cursorWait === undefined) {
    return false;
  }

  const advanced = await waitForNextPart(
    options.cursorWait,
    state.cursor,
    context.signal,
    context.timeoutMs
  );
  if (advanced === undefined) {
    return false;
  }

  const resolved = await resolveCommittedParts(
    options.store,
    options.sessionId,
    options.segmentObjectKey
  );
  if (resolved === undefined) {
    return false;
  }

  state.cursor = resolved.cursor;
  state.parts = resolved.parts;
  return true;
}

/** Enqueue the slice of `part` that starts at `position`. Returns bytes written. */
async function streamPart(
  context: ByterangeStreamContext,
  part: CommittedPart,
  position: number
): Promise<number> {
  const byterange = part.byterange;
  if (byterange === undefined) {
    throw new Error("part committed without byterange");
  }

  const rangeEnd = context.range.end;
  const startWithinPart = position - byterange.offset;
  const partRangeEnd =
    rangeEnd === undefined
      ? byterange.length - 1
      : Math.min(byterange.length - 1, rangeEnd - byterange.offset);

  const reader = await openPartBody(
    context,
    part,
    startWithinPart,
    partRangeEnd
  );
  const written = await pumpPartBody(
    context,
    reader,
    partRangeEnd - startWithinPart + 1
  );

  if (written === 0) {
    throw new Error(
      `part object returned no bytes for requested range: ${part.objectKey}`
    );
  }
  return written;
}

async function openPartBody(
  context: ByterangeStreamContext,
  part: CommittedPart,
  startWithinPart: number,
  partRangeEnd: number
): Promise<PartBodyReader> {
  const response = await context.options.client.send(
    new GetObjectCommand({
      Bucket: context.options.bucket,
      Key: part.objectKey,
      Range: `bytes=${startWithinPart}-${partRangeEnd}`,
    })
  );

  if (response.Body === undefined) {
    throw new Error(`part object returned no body: ${part.objectKey}`);
  }
  return response.Body.transformToWebStream().getReader();
}

async function pumpPartBody(
  context: ByterangeStreamContext,
  reader: PartBodyReader,
  lengthInPart: number
): Promise<number> {
  // Cancelling the reader on abort resolves a pending `read()`, so a stalled
  // part fetch cannot outlive the viewer.
  const cancelReader = () => {
    cancelQuietly(reader);
  };
  context.signal.addEventListener("abort", cancelReader, { once: true });

  try {
    return await enqueueClampedBytes(context, reader, lengthInPart);
  } finally {
    context.signal.removeEventListener("abort", cancelReader);
    // Cancel rather than release the lock: cancelling also lets the source
    // destroy its pooled socket.
    await cancelQuietly(reader);
  }
}

async function enqueueClampedBytes(
  context: ByterangeStreamContext,
  reader: PartBodyReader,
  lengthInPart: number
): Promise<number> {
  let written = 0;
  while (written < lengthInPart) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    // Clamp overshoot so a part fetch that ignores `Range` cannot push the
    // response past its promised `content-length`.
    const remaining = lengthInPart - written;
    const chunk =
      value.length > remaining ? value.subarray(0, remaining) : value;
    context.controller.enqueue(chunk);
    written += chunk.length;
  }
  return written;
}

/**
 * Best-effort cancel of a part body reader. Failures are swallowed: the
 * source may already be closed or errored, and the cancellation must not
 * mask the error that tore the stream down.
 */
async function cancelQuietly(reader: PartBodyReader): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The source is already closed or errored; nothing left to release.
  }
}

async function waitForNextPart(
  cursorWait: ByterangeCursorWait,
  cursor: Cursor,
  outerSignal: AbortSignal,
  timeoutMs: number
): Promise<Cursor | undefined> {
  if (outerSignal.aborted) {
    // The viewer is already gone; skip the wait entirely rather than hold a
    // cursor subscription (and its timer) for a response nobody reads.
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  outerSignal.addEventListener("abort", onOuterAbort, { once: true });

  try {
    return await cursorWait({ cursor, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    outerSignal.removeEventListener("abort", onOuterAbort);
  }
}
