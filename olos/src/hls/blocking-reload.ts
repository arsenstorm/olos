import { isEndOfStreamSessionState } from "../state/session";
import type { Cursor } from "../types/cursor";
import type { PartNumber, SequenceNumber } from "../types/ids";
import { assertCursor } from "../validation/cursor";
import { nonNegativeNumber } from "../validation/fields";
import {
  isInvalidHlsBlockingReloadResolution,
  isReadyHlsBlockingReloadResolution,
  nowMs,
  parseOptionalInteger,
  resolveHlsBlockingReloadValidated,
  timeoutHlsBlockingReloadResult,
  waitForNextCursor,
} from "./blocking-reload-resolve";
import { HLS_RELATIVE_REQUEST_BASE_URL } from "./uri";

export const HLS_MSN = "_HLS_msn";
export const HLS_PART = "_HLS_part";
export const SEGMENT_ONLY_LIVE_EDGE_PART = Number.MAX_SAFE_INTEGER;

/**
 * Blocking playlist reload directives parsed from an LL-HLS media playlist
 * request's `_HLS_msn` and `_HLS_part` query parameters. An empty object means
 * the request carried no blocking directives and can be served immediately.
 * A `partNumber` without a `sequenceNumber` is rejected as invalid by
 * `resolveHlsBlockingReload`.
 */
export interface HlsBlockingReloadRequest {
  partNumber?: PartNumber;
  sequenceNumber?: SequenceNumber;
  /**
   * When set, comparisons use this track's own committed-window bounds
   * (its last visible segment and part) instead of the window-global
   * `cursor.window` bounds — a lagging track then blocks until its own
   * playlist changes. `parseHlsBlockingReloadRequest` never sets this;
   * callers attach it after matching the request path to a track.
   */
  trackId?: string;
}

/**
 * Outcome of checking a blocking reload request against a cursor: `ready` when
 * the current playlist already satisfies the request, `block` when the
 * requested media sequence number or part is still beyond the live edge, and
 * `invalid` when the request itself is malformed (`_HLS_part` without
 * `_HLS_msn`).
 */
export type HlsBlockingReloadResolution =
  | {
      request: HlsBlockingReloadRequest;
      status: "ready" | "block";
    }
  | {
      message: string;
      status: "invalid";
    };

export type InvalidHlsBlockingReloadResolution = Extract<
  HlsBlockingReloadResolution,
  { status: "invalid" }
>;

export type ReadyHlsBlockingReloadResolution = Extract<
  HlsBlockingReloadResolution,
  { status: "ready" }
>;

/**
 * Context passed to the `waitForCursor` callback of
 * `waitForHlsBlockingReload`.
 */
export interface HlsCursorWaitContext {
  /** The cursor the wait is advancing from. */
  cursor: Cursor;
  request: HlsBlockingReloadRequest;
  /** Aborted when the blocking reload deadline expires. */
  signal: AbortSignal;
}

/** Options for `waitForHlsBlockingReload`. */
export interface WaitForHlsBlockingReloadOptions {
  /** The cursor to start resolving against. */
  cursor: Cursor;
  /**
   * Clock returning the current time in epoch milliseconds. Defaults to
   * `Date.now`.
   */
  now?: () => number;
  request: HlsBlockingReloadRequest;
  /**
   * Timer used to bound each `waitForCursor` round. Defaults to a real
   * `setTimeout`-based sleep that resolves early when `signal` aborts.
   */
  sleep?: (durationMs: number, signal: AbortSignal) => Promise<void>;
  /** Maximum total time to hold the reload open, in milliseconds. */
  timeoutMs: number;
  /**
   * Resolves with a newer cursor once the session advances, or `undefined` to
   * give up (which ends the wait as a timeout). `context.signal` aborts when
   * the deadline expires.
   */
  waitForCursor: (context: HlsCursorWaitContext) => Promise<Cursor | undefined>;
}

interface HlsBlockingReloadDeadline {
  readonly expiresAtMs: number;
}

/**
 * Outcome of `waitForHlsBlockingReload`: `ready` with the cursor that
 * satisfies the request, `timeout` with the latest cursor observed before the
 * deadline (still servable — callers should respond with the current
 * playlist), or `invalid` for a malformed request.
 */
export type WaitForHlsBlockingReloadResult =
  | {
      cursor: Cursor;
      request: HlsBlockingReloadRequest;
      status: "ready" | "timeout";
    }
  | {
      message: string;
      status: "invalid";
    };

type ReadyOrTimeoutHlsBlockingReloadResult = Extract<
  WaitForHlsBlockingReloadResult,
  { status: "ready" | "timeout" }
>;
type ReadyHlsBlockingReloadResult = ReadyOrTimeoutHlsBlockingReloadResult & {
  status: "ready";
};
export type TimeoutHlsBlockingReloadResult =
  ReadyOrTimeoutHlsBlockingReloadResult & {
    status: "timeout";
  };

/**
 * Extracts the `_HLS_msn` and `_HLS_part` blocking reload parameters from a
 * media playlist request URL. Accepts an absolute URL or a root-relative path
 * starting with `/`. Absent parameters are simply omitted from the result;
 * present parameters must be non-negative integers or the function throws.
 */
export function parseHlsBlockingReloadRequest(
  requestUrl: string
): HlsBlockingReloadRequest {
  const url = requestUrl.startsWith("/")
    ? new URL(requestUrl, HLS_RELATIVE_REQUEST_BASE_URL)
    : new URL(requestUrl);

  return {
    ...parseOptionalInteger(url.searchParams.get(HLS_MSN), HLS_MSN),
    ...parseOptionalInteger(url.searchParams.get(HLS_PART), HLS_PART),
  };
}

/** Whether this cursor already answers the request, one way or another. */
function settleBlockingReload(
  cursor: Cursor,
  options: WaitForHlsBlockingReloadOptions
): WaitForHlsBlockingReloadResult | undefined {
  const resolution = resolveHlsBlockingReloadValidated(cursor, options.request);

  if (isInvalidHlsBlockingReloadResolution(resolution)) {
    return resolution;
  }

  if (isReadyHlsBlockingReloadResolution(resolution)) {
    return readyHlsBlockingReloadResult(cursor, options.request);
  }

  // A terminal session commits nothing further, so a blocked request can
  // never be satisfied — resolve immediately with the final (ENDLIST)
  // playlist instead of pinning the request until the deadline.
  if (isEndOfStreamSessionState(cursor.state)) {
    return timeoutHlsBlockingReloadResult(cursor, options.request);
  }

  return;
}

/**
 * Holds an LL-HLS blocking playlist reload open until the requested media
 * sequence number and part are committed, the request turns out to be
 * immediately servable, or `timeoutMs` elapses. Repeatedly resolves the
 * request against the latest cursor and calls `waitForCursor` while it
 * resolves to `block`. A cursor in a terminal session state (`ended` or
 * `aborted`) resolves immediately as `timeout` — nothing further commits,
 * so the final ENDLIST playlist is served without waiting. A `timeout`
 * result still carries the most recent cursor so callers can serve the
 * current playlist. Throws if `cursor` (or a cursor produced by
 * `waitForCursor`) is malformed or `timeoutMs` is negative.
 */
export async function waitForHlsBlockingReload(
  options: WaitForHlsBlockingReloadOptions
): Promise<WaitForHlsBlockingReloadResult> {
  assertCursor(options.cursor);
  nonNegativeNumber(options.timeoutMs, "options.timeoutMs");

  const deadline = createHlsBlockingReloadDeadline(options);
  let cursor = options.cursor;

  for (;;) {
    const settled = settleBlockingReload(cursor, options);

    if (settled !== undefined) {
      return settled;
    }

    const remainingMs = remainingHlsBlockingReloadMs(deadline, options);

    if (remainingMs <= 0) {
      return timeoutHlsBlockingReloadResult(cursor, options.request);
    }

    const nextCursor = await waitForNextCursor(options, cursor, remainingMs);

    if (!nextCursor) {
      return timeoutHlsBlockingReloadResult(cursor, options.request);
    }

    assertCursor(nextCursor);
    cursor = nextCursor;
  }
}

function readyHlsBlockingReloadResult(
  cursor: Cursor,
  request: HlsBlockingReloadRequest
): ReadyHlsBlockingReloadResult {
  return {
    cursor,
    request,
    status: "ready",
  };
}

function createHlsBlockingReloadDeadline(
  options: WaitForHlsBlockingReloadOptions
): HlsBlockingReloadDeadline {
  return {
    expiresAtMs: nowMs(options) + options.timeoutMs,
  };
}

function remainingHlsBlockingReloadMs(
  deadline: HlsBlockingReloadDeadline,
  options: WaitForHlsBlockingReloadOptions
): number {
  return deadline.expiresAtMs - nowMs(options);
}

/**
 * Synchronously decides whether a blocking reload request is servable against
 * the given cursor. Requests without `sequenceNumber` are `ready`
 * immediately (`_HLS_part` alone is `invalid`). A request is `block` when its
 * media sequence number is past the live edge's last committed one, or when
 * it targets the last committed segment and asks for a part beyond that
 * segment's live edge; part requests never block on segment-only edges (no
 * committed parts). The live edge is `cursor.window`, or — when the request
 * carries a `trackId` — that track's own committed-window bounds
 * (a track absent from the window blocks any `_HLS_msn` request).
 * Throws if `cursor` is malformed.
 */
export function resolveHlsBlockingReload(
  cursor: Cursor,
  request: HlsBlockingReloadRequest
): HlsBlockingReloadResolution {
  assertCursor(cursor);

  return resolveHlsBlockingReloadValidated(cursor, request);
}

// The assertion-free core of `resolveHlsBlockingReload`, used by
// `waitForHlsBlockingReload` which validates each cursor exactly once.
