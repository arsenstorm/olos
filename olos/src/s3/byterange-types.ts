import type {
  GetObjectCommandOutput,
  GetObjectCommand as GetObjectCommandType,
} from "@aws-sdk/client-s3";
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

/** Options for `createByterangeSegmentResponse`. */
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

/** Parts of one virtual segment, with the cursor they were read from. */
export interface ResolvedByterangeParts {
  cursor: Cursor;
  parts: CommittedPart[];
}

/**
 * Last-byte-pos advertised in `content-range` for open-ended live ranges.
 * RFC 8673 §2 has the server respond with "a very large value" for the last
 * byte position when the representation is still growing; `MAX_SAFE_INTEGER`
 * is that value here.
 */
export const OPEN_ENDED_LAST_BYTE_POS = Number.MAX_SAFE_INTEGER;

/** Wall time a single cursor wait may block before the drain gives up. */
export const DEFAULT_CURSOR_WAIT_TIMEOUT_MS = 3000;
