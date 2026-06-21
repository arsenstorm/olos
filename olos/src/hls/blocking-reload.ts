import { nonNegativeNumber } from "../runtime/request-fields";
import type { Cursor } from "../types/cursor";
import type { MediaSequenceNumber, PartNumber } from "../types/ids";
import { assertCursor } from "../validation/cursor";
import { assertNonNegativeInteger } from "../validation/ids";
import { HLS_RELATIVE_REQUEST_BASE_URL } from "./uri";

const HLS_MSN = "_HLS_msn";
const HLS_PART = "_HLS_part";
const SEGMENT_ONLY_LIVE_EDGE_PART = Number.MAX_SAFE_INTEGER;

export interface HlsBlockingReloadRequest {
  mediaSequenceNumber?: MediaSequenceNumber;
  partNumber?: PartNumber;
}

export type HlsBlockingReloadResolution =
  | {
      request: HlsBlockingReloadRequest;
      status: "ready" | "block";
    }
  | {
      message: string;
      status: "invalid";
    };

type InvalidHlsBlockingReloadResolution = Extract<
  HlsBlockingReloadResolution,
  { status: "invalid" }
>;

type ReadyHlsBlockingReloadResolution = Extract<
  HlsBlockingReloadResolution,
  { status: "ready" }
>;

export interface HlsCursorWaitContext {
  cursor: Cursor;
  request: HlsBlockingReloadRequest;
  signal: AbortSignal;
}

export interface WaitForHlsBlockingReloadOptions {
  clock?: () => number;
  cursor: Cursor;
  now?: () => number;
  request: HlsBlockingReloadRequest;
  timeoutMs: number;
  waitForCursor: (context: HlsCursorWaitContext) => Promise<Cursor | undefined>;
}

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
type TimeoutHlsBlockingReloadResult = ReadyOrTimeoutHlsBlockingReloadResult & {
  status: "timeout";
};

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

export async function waitForHlsBlockingReload(
  options: WaitForHlsBlockingReloadOptions
): Promise<WaitForHlsBlockingReloadResult> {
  assertCursor(options.cursor);
  nonNegativeNumber(options.timeoutMs, "options.timeoutMs");

  const deadline = nowMs(options) + options.timeoutMs;
  let cursor = options.cursor;

  for (;;) {
    const resolution = resolveHlsBlockingReload(cursor, options.request);

    if (isInvalidHlsBlockingReloadResolution(resolution)) {
      return resolution;
    }

    if (isReadyHlsBlockingReloadResolution(resolution)) {
      return {
        cursor,
        request: options.request,
        status: "ready",
      };
    }

    const remainingMs = deadline - nowMs(options);

    if (remainingMs <= 0) {
      return timeoutHlsBlockingReloadResult(cursor, options.request);
    }

    const nextCursor = await waitForNextCursor(options, cursor, remainingMs);

    if (!nextCursor) {
      return timeoutHlsBlockingReloadResult(cursor, options.request);
    }

    cursor = nextCursor;
  }
}

export function resolveHlsBlockingReload(
  cursor: Cursor,
  request: HlsBlockingReloadRequest
): HlsBlockingReloadResolution {
  assertCursor(cursor);

  if (
    request.mediaSequenceNumber === undefined &&
    request.partNumber !== undefined
  ) {
    return {
      message: "_HLS_part requires _HLS_msn",
      status: "invalid",
    };
  }

  if (request.mediaSequenceNumber === undefined) {
    return { request, status: "ready" };
  }

  if (request.mediaSequenceNumber > cursor.window.lastMediaSequenceNumber) {
    return { request, status: "block" };
  }

  if (request.mediaSequenceNumber < cursor.window.lastMediaSequenceNumber) {
    return { request, status: "ready" };
  }

  return {
    request,
    status: resolveLiveEdgePartStatus(cursor, request),
  };
}

function timeoutHlsBlockingReloadResult(
  cursor: Cursor,
  request: HlsBlockingReloadRequest
): TimeoutHlsBlockingReloadResult {
  return {
    cursor,
    request,
    status: "timeout",
  };
}

function resolveLiveEdgePartStatus(
  cursor: Cursor,
  request: HlsBlockingReloadRequest
): "block" | "ready" {
  const liveEdgePart =
    cursor.window.lastPartNumber ?? SEGMENT_ONLY_LIVE_EDGE_PART;

  return request.partNumber !== undefined && request.partNumber > liveEdgePart
    ? "block"
    : "ready";
}

function isInvalidHlsBlockingReloadResolution(
  resolution: HlsBlockingReloadResolution
): resolution is InvalidHlsBlockingReloadResolution {
  return resolution.status === "invalid";
}

function isReadyHlsBlockingReloadResolution(
  resolution: HlsBlockingReloadResolution
): resolution is ReadyHlsBlockingReloadResolution {
  return resolution.status === "ready";
}

function parseOptionalInteger(
  value: string | null,
  name: typeof HLS_MSN | typeof HLS_PART
): Partial<HlsBlockingReloadRequest> {
  if (value === null) {
    return {};
  }

  const number = Number(value);

  assertNonNegativeInteger(number, name);

  return name === HLS_MSN
    ? { mediaSequenceNumber: number }
    : { partNumber: number };
}

async function waitForNextCursor(
  options: WaitForHlsBlockingReloadOptions,
  cursor: Cursor,
  timeoutMs: number
): Promise<Cursor | undefined> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      options.waitForCursor({
        cursor,
        request: options.request,
        signal: controller.signal,
      }),
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort();
          resolve(undefined);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }

    controller.abort();
  }
}

function nowMs(options: WaitForHlsBlockingReloadOptions): number {
  if (options.now !== undefined) {
    return options.now();
  }

  if (options.clock === undefined) {
    return Date.now();
  }

  return options.clock();
}
