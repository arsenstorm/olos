import {
  type TrackWindowBounds,
  trackWindowBounds,
} from "../state/committed-window";
import type { Cursor } from "../types/cursor";
import { assertNonNegativeInteger } from "../validation/ids";
import {
  HLS_MSN,
  type HLS_PART,
  type HlsBlockingReloadRequest,
  type HlsBlockingReloadResolution,
  type InvalidHlsBlockingReloadResolution,
  type ReadyHlsBlockingReloadResolution,
  SEGMENT_ONLY_LIVE_EDGE_PART,
  type TimeoutHlsBlockingReloadResult,
  type WaitForHlsBlockingReloadOptions,
} from "./blocking-reload";
export function resolveHlsBlockingReloadValidated(
  cursor: Cursor,
  request: HlsBlockingReloadRequest
): HlsBlockingReloadResolution {
  if (isPartOnlyBlockingRequest(request)) {
    return {
      message: "_HLS_part requires _HLS_msn",
      status: "invalid",
    };
  }

  if (request.sequenceNumber === undefined) {
    return { request, status: "ready" };
  }

  const bounds = blockingReloadBounds(cursor, request);

  // The requested track has no committed media yet, so any requested
  // position is beyond its live edge.
  if (bounds === undefined) {
    return { request, status: "block" };
  }

  const mediaSequenceStatus = resolveMediaSequenceReloadStatus(bounds, request);

  if (mediaSequenceStatus !== undefined) {
    return { request, status: mediaSequenceStatus };
  }

  return {
    request,
    status: resolveLiveEdgePartStatus(bounds, request),
  };
}

function blockingReloadBounds(
  cursor: Cursor,
  request: HlsBlockingReloadRequest
): TrackWindowBounds | undefined {
  if (request.trackId === undefined) {
    return {
      lastSequenceNumber: cursor.window.lastSequenceNumber,
      ...(cursor.window.lastPartNumber === undefined
        ? {}
        : { lastPartNumber: cursor.window.lastPartNumber }),
    };
  }

  return trackWindowBounds(cursor.committedWindow, request.trackId);
}

function isPartOnlyBlockingRequest(request: HlsBlockingReloadRequest): boolean {
  return (
    request.sequenceNumber === undefined && request.partNumber !== undefined
  );
}

function resolveMediaSequenceReloadStatus(
  bounds: TrackWindowBounds,
  request: HlsBlockingReloadRequest
): "block" | "ready" | undefined {
  if (request.sequenceNumber === undefined) {
    return;
  }

  if (request.sequenceNumber > bounds.lastSequenceNumber) {
    return "block";
  }

  if (request.sequenceNumber < bounds.lastSequenceNumber) {
    return "ready";
  }

  return;
}

export function timeoutHlsBlockingReloadResult(
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
  bounds: TrackWindowBounds,
  request: HlsBlockingReloadRequest
): "block" | "ready" {
  return isRequestedPartBeyondLiveEdge(bounds, request) ? "block" : "ready";
}

function isRequestedPartBeyondLiveEdge(
  bounds: TrackWindowBounds,
  request: HlsBlockingReloadRequest
): boolean {
  const liveEdgePart = bounds.lastPartNumber ?? SEGMENT_ONLY_LIVE_EDGE_PART;

  return request.partNumber !== undefined && request.partNumber > liveEdgePart;
}

export function isInvalidHlsBlockingReloadResolution(
  resolution: HlsBlockingReloadResolution
): resolution is InvalidHlsBlockingReloadResolution {
  return resolution.status === "invalid";
}

export function isReadyHlsBlockingReloadResolution(
  resolution: HlsBlockingReloadResolution
): resolution is ReadyHlsBlockingReloadResolution {
  return resolution.status === "ready";
}

export function parseOptionalInteger(
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

// Spec §8.7: the raw value must itself be a non-negative integer literal —
// `Number()` alone also accepts "0x10", "1e3", " 5", and "+5".
const NON_NEGATIVE_INTEGER_STRING_PATTERN = /^(?:0|[1-9]\d*)$/;

function parseBlockingReloadInteger(
  value: string,
  name: typeof HLS_MSN | typeof HLS_PART
): number {
  const number = NON_NEGATIVE_INTEGER_STRING_PATTERN.test(value)
    ? Number(value)
    : Number.NaN;

  assertNonNegativeInteger(number, name);

  return number;
}

function parsedBlockingReloadRequestField(
  name: typeof HLS_MSN | typeof HLS_PART,
  number: number
): Partial<HlsBlockingReloadRequest> {
  return name === HLS_MSN ? { sequenceNumber: number } : { partNumber: number };
}

export async function waitForNextCursor(
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

export function nowMs(options: WaitForHlsBlockingReloadOptions): number {
  return options.now === undefined ? Date.now() : options.now();
}
