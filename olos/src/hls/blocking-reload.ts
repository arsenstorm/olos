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
  sleep?: (durationMs: number, signal: AbortSignal) => Promise<void>;
  timeoutMs: number;
  waitForCursor: (context: HlsCursorWaitContext) => Promise<Cursor | undefined>;
}

interface HlsBlockingReloadDeadline {
  readonly expiresAtMs: number;
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
type ReadyHlsBlockingReloadResult = ReadyOrTimeoutHlsBlockingReloadResult & {
  status: "ready";
};
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

  const deadline = createHlsBlockingReloadDeadline(options);
  let cursor = options.cursor;

  for (;;) {
    const resolution = resolveHlsBlockingReload(cursor, options.request);

    if (isInvalidHlsBlockingReloadResolution(resolution)) {
      return resolution;
    }

    if (isReadyHlsBlockingReloadResolution(resolution)) {
      return readyHlsBlockingReloadResult(cursor, options.request);
    }

    const remainingMs = remainingHlsBlockingReloadMs(deadline, options);

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

export function resolveHlsBlockingReload(
  cursor: Cursor,
  request: HlsBlockingReloadRequest
): HlsBlockingReloadResolution {
  assertCursor(cursor);

  if (isPartOnlyBlockingRequest(request)) {
    return {
      message: "_HLS_part requires _HLS_msn",
      status: "invalid",
    };
  }

  if (request.mediaSequenceNumber === undefined) {
    return { request, status: "ready" };
  }

  const mediaSequenceStatus = resolveMediaSequenceReloadStatus(cursor, request);

  if (mediaSequenceStatus !== undefined) {
    return { request, status: mediaSequenceStatus };
  }

  return {
    request,
    status: resolveLiveEdgePartStatus(cursor, request),
  };
}

function isPartOnlyBlockingRequest(request: HlsBlockingReloadRequest): boolean {
  return (
    request.mediaSequenceNumber === undefined &&
    request.partNumber !== undefined
  );
}

function resolveMediaSequenceReloadStatus(
  cursor: Cursor,
  request: HlsBlockingReloadRequest
): "block" | "ready" | undefined {
  if (request.mediaSequenceNumber === undefined) {
    return;
  }

  if (request.mediaSequenceNumber > cursor.window.lastMediaSequenceNumber) {
    return "block";
  }

  if (request.mediaSequenceNumber < cursor.window.lastMediaSequenceNumber) {
    return "ready";
  }

  return;
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
  return isRequestedPartBeyondLiveEdge(cursor, request) ? "block" : "ready";
}

function isRequestedPartBeyondLiveEdge(
  cursor: Cursor,
  request: HlsBlockingReloadRequest
): boolean {
  const liveEdgePart =
    cursor.window.lastPartNumber ?? SEGMENT_ONLY_LIVE_EDGE_PART;

  return request.partNumber !== undefined && request.partNumber > liveEdgePart;
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

  return parsedBlockingReloadRequestField(
    name,
    parseBlockingReloadInteger(value, name)
  );
}

function parseBlockingReloadInteger(
  value: string,
  name: typeof HLS_MSN | typeof HLS_PART
): number {
  const number = Number(value);

  assertNonNegativeInteger(number, name);

  return number;
}

function parsedBlockingReloadRequestField(
  name: typeof HLS_MSN | typeof HLS_PART,
  number: number
): Partial<HlsBlockingReloadRequest> {
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
  const sleep = options.sleep ?? sleepWithAbort;

  try {
    return await Promise.race([
      options.waitForCursor({
        cursor,
        request: options.request,
        signal: controller.signal,
      }),
      sleep(timeoutMs, controller.signal).then(() => undefined),
    ]);
  } finally {
    controller.abort();
  }
}

function sleepWithAbort(timeoutMs: number, signal: AbortSignal): Promise<void> {
  if (timeoutMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolved = false;

    const finish = () => {
      if (resolved) {
        return;
      }

      resolved = true;
      signal.removeEventListener("abort", finish);

      if (timer !== undefined) {
        clearTimeout(timer);
      }

      resolve();
    };

    if (signal.aborted) {
      finish();
      return;
    }

    timer = setTimeout(finish, timeoutMs);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function nowMs(options: WaitForHlsBlockingReloadOptions): number {
  if (options.now !== undefined) {
    return options.now();
  }

  if (options.clock !== undefined) {
    return options.clock();
  }

  return Date.now();
}
