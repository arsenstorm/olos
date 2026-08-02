import type {
  GetObjectCommandOutput,
  GetObjectCommand as GetObjectCommandType,
} from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { CoordinatorPipelineStore } from "../protocol/coordinator-types";
import type { CommittedPart } from "../types/committed-window";
import type { Cursor } from "../types/cursor";

/**
 * Narrowed S3 client surface used to fetch part objects for byterange-aggregated
 * segment responses. Mirrors the `S3HeadObjectClient` / `S3DeleteObjectClient`
 * pattern in `olos/s3` so callers can plug in a minimal wrapper rather than the
 * full `@aws-sdk/client-s3` `S3Client`.
 */
export interface S3GetObjectClient {
  send(command: GetObjectCommandType): Promise<GetObjectCommandOutput>;
}

/** Parsed byte range from an HTTP `Range: bytes=start-end` request header. */
export interface ByterangeRangeRequest {
  /** Inclusive end byte. `undefined` means open-ended (`bytes=start-`). */
  end?: number;
  /** First byte requested. */
  start: number;
}

/** Arguments passed to a {@link ByterangeCursorWait} callback. */
export interface ByterangeCursorWaitContext {
  /** Cursor the response has already seen; wait for one that advances past it. */
  cursor: Cursor;
  /** Aborted when the wait times out or the viewer disconnects. */
  signal: AbortSignal;
}

/**
 * Callback that resolves with the session's next cursor once a commit advances
 * it past `context.cursor`, or with `undefined` if `context.signal` aborts
 * first. Backed by whatever notification channel the runtime provides
 * (Durable Object wakeups, pub/sub, polling).
 */
export type ByterangeCursorWait = (
  context: ByterangeCursorWaitContext
) => Promise<Cursor | undefined>;

/** Options for {@link createByterangeSegmentResponse}. */
export interface CreateByterangeSegmentResponseOptions {
  bucket: string;
  client: S3GetObjectClient;
  /**
   * Awaitable that resolves when a new commit advances the session's cursor.
   * The helper uses it to hold the response open for ranges that extend past
   * the bytes currently committed (the `EXT-X-PRELOAD-HINT` path).
   */
  cursorWait?: ByterangeCursorWait;
  range?: ByterangeRangeRequest;
  segmentObjectKey: string;
  sessionId: string;
  signal?: AbortSignal;
  store: CoordinatorPipelineStore;
  /** Max wall time spent waiting on the cursor for new bytes (default 3000 ms). */
  timeoutMs?: number;
}

interface ResolvedByterangeParts {
  cursor: Cursor;
  parts: CommittedPart[];
}

/**
 * Last-byte-pos advertised in `content-range` for open-ended live ranges.
 * RFC 8673 §2 has the server respond with "a very large value" for the last
 * byte position when the representation is still growing; `MAX_SAFE_INTEGER`
 * is that value here.
 */
const OPEN_ENDED_LAST_BYTE_POS = Number.MAX_SAFE_INTEGER;

/**
 * Serve a Range request against the virtual segment identified by
 * `segmentObjectKey`. The helper looks up the part commits in OLOS's
 * coordinator state, fetches each part's S3 object, and streams the requested
 * bytes. If the requested range extends past the committed parts, the helper
 * blocks on `cursorWait` until the next commit lands, then continues — the
 * mechanism that makes `EXT-X-PRELOAD-HINT` deliver bytes as soon as the
 * streamer publishes them.
 *
 * Bounded ranges (`range.end` set) are served as 206 with a `content-range`
 * and `content-length`; if the committed parts run out before the promised
 * end, the stream errors rather than closing short. Open-ended requests
 * (no `range.end`, any offset) stream a live aggregate of unknown total
 * length; any request that carried a Range header is a 206 (RFC 8673, with
 * a very-large last-byte-pos in `content-range` and no `content-length`),
 * and only rangeless requests are a plain 200.
 */
export async function createByterangeSegmentResponse(
  options: CreateByterangeSegmentResponseOptions
): Promise<Response> {
  const requested = options.range ?? { start: 0 };
  if (requested.start < 0) {
    return new Response("invalid range", { status: 416 });
  }
  if (requested.end !== undefined && requested.end < requested.start) {
    return new Response("invalid range", { status: 416 });
  }
  // A bounded end at or past the open-ended sentinel is a client spelling
  // out RFC 8673's "very large value"; normalize it to an open-ended range.
  const range: ByterangeRangeRequest =
    requested.end !== undefined && requested.end >= OPEN_ENDED_LAST_BYTE_POS
      ? { start: requested.start }
      : requested;

  const initial = await resolveCommittedParts(
    options.store,
    options.sessionId,
    options.segmentObjectKey
  );
  if (initial === undefined) {
    return new Response("not found", { status: 404 });
  }

  const stream = createByterangeStream(options, initial, range);
  const headers = responseHeaders(range, options.range !== undefined);
  const status = options.range === undefined ? 200 : 206;

  return new Response(stream, { headers, status });
}

interface ByterangeStreamState {
  cursor: Cursor;
  parts: CommittedPart[];
  position: number;
}

function createByterangeStream(
  options: CreateByterangeSegmentResponseOptions,
  initial: ResolvedByterangeParts,
  range: ByterangeRangeRequest
): ReadableStream<Uint8Array> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const state: ByterangeStreamState = {
    cursor: initial.cursor,
    parts: initial.parts,
    position: range.start,
  };

  // One signal covers both termination paths: the viewer disconnecting
  // (`options.signal`) and the consumer cancelling the response body.
  const abort = new AbortController();
  const onOuterAbort = () => abort.abort();
  if (options.signal?.aborted) {
    abort.abort();
  } else {
    options.signal?.addEventListener("abort", onOuterAbort, { once: true });
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        await drainByterange(
          options,
          controller,
          state,
          range,
          timeoutMs,
          abort.signal
        );
        controller.close();
      } catch (error) {
        // After an abort the stream is already dead; erroring it would only
        // produce noise (and `close()` throws once the consumer cancels).
        if (!abort.signal.aborted) {
          controller.error(error);
        }
      } finally {
        options.signal?.removeEventListener("abort", onOuterAbort);
      }
    },
    cancel() {
      // Consumer cancelled the body. Abort so in-flight S3 part reads and
      // cursor waits release instead of holding their sockets open.
      abort.abort();
    },
  });
}

async function drainByterange(
  options: CreateByterangeSegmentResponseOptions,
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: ByterangeStreamState,
  range: ByterangeRangeRequest,
  timeoutMs: number,
  signal: AbortSignal
): Promise<void> {
  while (range.end === undefined || state.position <= range.end) {
    if (signal.aborted) {
      return;
    }
    const next = nextPartCovering(state.parts, state.position);
    if (next !== undefined) {
      const written = await streamPart(
        options,
        controller,
        next,
        state.position,
        range.end,
        signal
      );
      if (written === 0) {
        // `streamPart` throws before returning 0; guard against regressions
        // that would otherwise spin this loop forever on the same part.
        throw new Error("byterange stream made no forward progress");
      }
      state.position += written;
      continue;
    }

    if (!(await advanceCursor(options, state, timeoutMs, signal))) {
      if (range.end !== undefined && state.position <= range.end) {
        // A bounded response already promised `content-length`; erroring the
        // stream surfaces an aborted transfer instead of a silently short 206.
        throw new Error("byterange stream ended before requested end");
      }
      return;
    }
  }
}

async function advanceCursor(
  options: CreateByterangeSegmentResponseOptions,
  state: ByterangeStreamState,
  timeoutMs: number,
  signal: AbortSignal
): Promise<boolean> {
  if (options.cursorWait === undefined) {
    return false;
  }
  const advanced = await waitForNextPart(
    options.cursorWait,
    state.cursor,
    signal,
    timeoutMs
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

async function streamPart(
  options: CreateByterangeSegmentResponseOptions,
  controller: ReadableStreamDefaultController<Uint8Array>,
  part: CommittedPart,
  position: number,
  rangeEnd: number | undefined,
  signal: AbortSignal
): Promise<number> {
  const byterange = part.byterange;
  if (byterange === undefined) {
    throw new Error("part committed without byterange");
  }
  const startWithinPart = position - byterange.offset;
  const partRangeEnd =
    rangeEnd === undefined
      ? byterange.length - 1
      : Math.min(byterange.length - 1, rangeEnd - byterange.offset);
  const lengthInPart = partRangeEnd - startWithinPart + 1;

  const response = await options.client.send(
    new GetObjectCommand({
      Bucket: options.bucket,
      Key: part.objectKey,
      Range: rangeHeaderValue(startWithinPart, partRangeEnd),
    })
  );

  if (response.Body === undefined) {
    throw new Error(`part object returned no body: ${part.objectKey}`);
  }

  const reader = response.Body.transformToWebStream().getReader();
  // Cancelling the reader on abort resolves a pending `read()`, so a stalled
  // part fetch cannot outlive the viewer.
  const cancelReader = () => {
    cancelQuietly(reader);
  };
  signal.addEventListener("abort", cancelReader, { once: true });
  let written = 0;
  try {
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
      controller.enqueue(chunk);
      written += chunk.length;
    }
  } finally {
    signal.removeEventListener("abort", cancelReader);
    // Cancel rather than release the lock: cancelling also lets the source
    // destroy its pooled socket.
    await cancelQuietly(reader);
  }

  if (written === 0) {
    throw new Error(
      `part object returned no bytes for requested range: ${part.objectKey}`
    );
  }

  return written;
}

/**
 * Best-effort cancel of a part body reader. Failures are swallowed: the
 * source may already be closed or errored, and the cancellation must not
 * mask the error that tore the stream down. Typed structurally because the
 * SDK body reader carries the DOM reader type, not Bun's.
 */
async function cancelQuietly(reader: {
  cancel(): Promise<unknown>;
}): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The source is already closed or errored; nothing left to release.
  }
}

function nextPartCovering(
  parts: readonly CommittedPart[],
  position: number
): CommittedPart | undefined {
  for (const part of parts) {
    const byterange = part.byterange;
    if (byterange === undefined) {
      continue;
    }
    if (
      byterange.offset <= position &&
      position < byterange.offset + byterange.length
    ) {
      return part;
    }
  }
  return;
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

async function resolveCommittedParts(
  store: CoordinatorPipelineStore,
  sessionId: string,
  segmentObjectKey: string
): Promise<ResolvedByterangeParts | undefined> {
  const snapshot = await store.load(sessionId);
  if (snapshot === undefined) {
    return;
  }
  const cursor = snapshot.state.cursor;
  if (cursor === undefined) {
    return;
  }

  const parts = collectByterangeParts(cursor, segmentObjectKey);
  return { cursor, parts };
}

function collectByterangeParts(
  cursor: Cursor,
  segmentObjectKey: string
): CommittedPart[] {
  const collected: CommittedPart[] = [];
  for (const rendition of Object.values(cursor.committedWindow.renditions)) {
    for (const segment of rendition.segments) {
      for (const part of segment.parts ?? []) {
        if (part.byterange?.segmentObjectKey === segmentObjectKey) {
          collected.push(part);
        }
      }
    }
  }
  return collected.sort(
    (a, b) => (a.byterange?.offset ?? 0) - (b.byterange?.offset ?? 0)
  );
}

function rangeHeaderValue(start: number, end: number): string {
  return `bytes=${start}-${end}`;
}

function responseHeaders(
  range: ByterangeRangeRequest,
  explicitRange: boolean
): Headers {
  const headers = new Headers({
    "accept-ranges": "bytes",
    "cache-control": "no-store",
    "content-type": "video/mp4",
  });
  if (range.end !== undefined) {
    headers.set("content-range", `bytes ${range.start}-${range.end}/*`);
    headers.set("content-length", String(range.end - range.start + 1));
  } else if (explicitRange) {
    // RFC 8673 §2: an open-ended live range answers with a very large
    // last-byte-pos and no content-length; the body streams to the live edge
    // and a clean close marks the end of the available content.
    headers.set(
      "content-range",
      `bytes ${range.start}-${OPEN_ENDED_LAST_BYTE_POS}/*`
    );
  }
  return headers;
}
