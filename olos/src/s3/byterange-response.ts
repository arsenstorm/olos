import type {
  GetObjectCommandOutput,
  GetObjectCommand as GetObjectCommandType,
} from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { CoordinatorPipelineStore } from "../protocol";
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

export interface ByterangeRangeRequest {
  /** Inclusive end byte. `undefined` means open-ended (`bytes=start-`). */
  end?: number;
  /** First byte requested. */
  start: number;
}

export interface ByterangeCursorWaitContext {
  cursor: Cursor;
  signal: AbortSignal;
}

export type ByterangeCursorWait = (
  context: ByterangeCursorWaitContext
) => Promise<Cursor | undefined>;

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
 * Serve a Range request against the virtual segment identified by
 * `segmentObjectKey`. The helper looks up the part commits in OLOS's
 * coordinator state, fetches each part's S3 object, and streams the requested
 * bytes. If the requested range extends past the committed parts, the helper
 * blocks on `cursorWait` until the next commit lands, then continues — the
 * mechanism that makes `EXT-X-PRELOAD-HINT` deliver bytes as soon as the
 * streamer publishes them.
 */
export async function createByterangeSegmentResponse(
  options: CreateByterangeSegmentResponseOptions
): Promise<Response> {
  const range = options.range ?? { start: 0 };
  if (range.start < 0) {
    return new Response("invalid range", { status: 416 });
  }
  if (range.end !== undefined && range.end < range.start) {
    return new Response("invalid range", { status: 416 });
  }

  const initial = await resolveCommittedParts(
    options.store,
    options.sessionId,
    options.segmentObjectKey
  );
  if (initial === undefined) {
    return new Response("not found", { status: 404 });
  }

  const stream = createByterangeStream(options, initial, range);
  const headers = responseHeaders(range);
  const status = range.start === 0 && range.end === undefined ? 200 : 206;

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

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        await drainByterange(options, controller, state, range, timeoutMs);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      // Viewer disconnected. Pending S3 reads drop with the response.
    },
  });
}

async function drainByterange(
  options: CreateByterangeSegmentResponseOptions,
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: ByterangeStreamState,
  range: ByterangeRangeRequest,
  timeoutMs: number
): Promise<void> {
  while (range.end === undefined || state.position <= range.end) {
    const next = nextPartCovering(state.parts, state.position);
    if (next !== undefined) {
      const written = await streamPart(
        options,
        controller,
        next,
        state.position,
        range.end
      );
      state.position += written;
      continue;
    }

    if (!(await advanceCursor(options, state, timeoutMs))) {
      return;
    }
  }
}

async function advanceCursor(
  options: CreateByterangeSegmentResponseOptions,
  state: ByterangeStreamState,
  timeoutMs: number
): Promise<boolean> {
  if (options.cursorWait === undefined) {
    return false;
  }
  const advanced = await waitForNextPart(
    options.cursorWait,
    state.cursor,
    options.signal,
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
  rangeEnd: number | undefined
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
    return 0;
  }

  const reader = response.Body.transformToWebStream().getReader();
  let written = 0;
  while (written < lengthInPart) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    controller.enqueue(value);
    written += value.length;
  }
  reader.releaseLock();

  return written;
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
  outerSignal: AbortSignal | undefined,
  timeoutMs: number
): Promise<Cursor | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  outerSignal?.addEventListener("abort", onOuterAbort, { once: true });

  try {
    return await cursorWait({ cursor, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
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

function responseHeaders(range: ByterangeRangeRequest): Headers {
  const headers = new Headers({
    "accept-ranges": "bytes",
    "cache-control": "no-store",
    "content-type": "video/mp4",
  });
  if (range.end !== undefined) {
    headers.set("content-range", `bytes ${range.start}-${range.end}/*`);
    headers.set("content-length", String(range.end - range.start + 1));
  } else if (range.start > 0) {
    // Open-ended ranges are streamed as chunked; total length is unknown.
    headers.set("content-range", `bytes ${range.start}-/*`);
  }
  return headers;
}
