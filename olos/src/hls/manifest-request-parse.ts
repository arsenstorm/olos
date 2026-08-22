import type { Session, Track } from "../types/session";
import {
  parseHlsBlockingReloadRequest,
  type waitForHlsBlockingReload,
} from "./blocking-reload";
import {
  HLS_TEXT_ERROR_CONTENT_TYPE,
  type InvalidParsedBlockingReloadRequest,
  type ParsedBlockingReloadRequest,
  type ServableBlockingReloadWait,
} from "./manifest-artifact-types";
import { HLS_RELATIVE_REQUEST_BASE_URL } from "./uri";
export function parseBlockingReloadRequest(
  requestUrl: string
): ParsedBlockingReloadRequest {
  try {
    return parseHlsBlockingReloadRequest(requestUrl);
  } catch (error) {
    return invalidParsedBlockingReloadRequest(
      error instanceof Error ? error.message : "invalid request URL"
    );
  }
}

function invalidParsedBlockingReloadRequest(
  message: string
): InvalidParsedBlockingReloadRequest {
  return {
    message,
    status: "invalid",
  };
}

export function isInvalidParsedBlockingReloadRequest(
  request: ParsedBlockingReloadRequest
): request is InvalidParsedBlockingReloadRequest {
  return "status" in request;
}

export function isServableBlockingReloadWait(
  wait: Awaited<ReturnType<typeof waitForHlsBlockingReload>>
): wait is ServableBlockingReloadWait {
  return wait.status === "ready" || wait.status === "timeout";
}

export function defaultMasterPath(session: Session): string {
  return `/v1/live/${session.sessionId}/master.m3u8`;
}

export function defaultMediaPlaylistPath(
  session: Session,
  track: Track
): string {
  return `/v1/live/${session.sessionId}/${track.trackId}/media.m3u8`;
}

export function parseRequestPath(value: string): string | undefined {
  if (isRelativeRequestPath(value)) {
    return new URL(value, HLS_RELATIVE_REQUEST_BASE_URL).pathname;
  }

  return parseAbsoluteRequestPath(value);
}

function isRelativeRequestPath(value: string): boolean {
  return value.startsWith("/");
}

function parseAbsoluteRequestPath(value: string): string | undefined {
  try {
    const url = new URL(value);

    if (!isHttpRequestUrl(url)) {
      return;
    }

    return url.pathname;
  } catch {
    return;
  }
}

function isHttpRequestUrl(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

export function createHlsTextErrorWebResponse(
  body: string,
  status: 400 | 404
): Response {
  return new Response(body, {
    headers: { "content-type": HLS_TEXT_ERROR_CONTENT_TYPE },
    status,
  });
}
