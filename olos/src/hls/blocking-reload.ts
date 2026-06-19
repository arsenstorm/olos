import type { Cursor } from "../types/cursor";
import type { MediaSequenceNumber, PartNumber } from "../types/ids";
import { assertCursor } from "../validation/cursor";

const HLS_MSN = "_HLS_msn";
const HLS_PART = "_HLS_part";

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
  cursor: Cursor;
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

export function parseHlsBlockingReloadRequest(
  requestUrl: string
): HlsBlockingReloadRequest {
  const url = requestUrl.startsWith("/")
    ? new URL(requestUrl, "https://olos.local")
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
  assertTimeout(options.timeoutMs);

  const deadline = Date.now() + options.timeoutMs;
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

    const remainingMs = deadline - Date.now();

    if (remainingMs <= 0) {
      return {
        cursor,
        request: options.request,
        status: "timeout",
      };
    }

    const nextCursor = await waitForNextCursor(options, cursor, remainingMs);

    if (!nextCursor) {
      return {
        cursor,
        request: options.request,
        status: "timeout",
      };
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

function resolveLiveEdgePartStatus(
  cursor: Cursor,
  request: HlsBlockingReloadRequest
): "block" | "ready" {
  const liveEdgePart = cursor.window.lastPartNumber ?? Number.MAX_SAFE_INTEGER;

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

  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }

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

function assertTimeout(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("options.timeoutMs must be a non-negative number");
  }
}
