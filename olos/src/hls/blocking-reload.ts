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

  const liveEdgePart = cursor.window.lastPartNumber ?? Number.MAX_SAFE_INTEGER;

  return {
    request,
    status:
      request.partNumber !== undefined && request.partNumber > liveEdgePart
        ? "block"
        : "ready",
  };
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
