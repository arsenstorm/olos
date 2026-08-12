import { createDeliveryCachePolicy } from "../state/cache-policy";
import { renditionWindowBounds } from "../state/committed-window";
import { isEndOfStreamSessionState } from "../state/session";
import type { Cursor } from "../types/cursor";
import type { Rendition, Session } from "../types/session";
import {
  type HlsBlockingReloadRequest,
  waitForHlsBlockingReload,
} from "./blocking-reload";
import type {
  BlockingHlsManifestArtifactResponseResolution,
  CreateHlsManifestArtifactResponseOptions,
  CreateHlsManifestArtifactsOptions,
  HlsManifestArtifact,
  HlsManifestArtifactResponse,
  HlsManifestErrorResolution,
  HlsManifestResponseArtifact,
  ResolveBlockingHlsManifestArtifactResponseOptions,
} from "./manifest-artifact-types";
import {
  createMasterPlaylistArtifact,
  createMediaPlaylistArtifact,
  hasAvailableVideoRendition,
  isMediaPlaylistRendition,
} from "./manifest-artifacts";
import {
  createHlsTextErrorWebResponse,
  defaultMasterPath,
  defaultMediaPlaylistPath,
  isInvalidParsedBlockingReloadRequest,
  isServableBlockingReloadWait,
  parseBlockingReloadRequest,
  parseRequestPath,
} from "./manifest-request-parse";
/**
 * Wraps a manifest artifact in a 200 response with `content-type` and a
 * `cache-control` header from the manifest delivery cache policy.
 */
export function createHlsManifestArtifactResponse(
  artifact: HlsManifestArtifact,
  options: CreateHlsManifestArtifactResponseOptions = {}
): HlsManifestArtifactResponse {
  const cache = createDeliveryCachePolicy({
    ...options,
    target: "manifest",
  });

  return {
    body: artifact.body,
    headers: {
      "cache-control": cache.cacheControl,
      "content-type": artifact.contentType,
    },
    status: 200,
  };
}

/** Converts a manifest artifact response into a Fetch API `Response`. */
export function createHlsManifestWebResponse(
  response: HlsManifestArtifactResponse
): Response {
  return new Response(response.body, {
    headers: response.headers,
    status: response.status,
  });
}

/**
 * Converts an error resolution into a plain-text Fetch API `Response`:
 * `invalid` becomes a 400 whose body is the resolution's message, and
 * `not_found` becomes a 404 with the body `manifest not found`. Both use
 * `text/plain; charset=utf-8`.
 */
export function createHlsManifestErrorWebResponse(
  resolution: HlsManifestErrorResolution
): Response {
  if (resolution.status === "invalid") {
    return createHlsTextErrorWebResponse(resolution.message, 400);
  }

  return createHlsTextErrorWebResponse("manifest not found", 404);
}

/**
 * Finds the response whose artifact path matches the request's pathname.
 * Accepts a root-relative path or an absolute http(s) URL; query parameters
 * are ignored. Returns `undefined` when no artifact matches or the request
 * path cannot be parsed as an http(s) URL.
 */
export function resolveHlsManifestArtifactResponse(
  artifacts: readonly HlsManifestResponseArtifact[],
  requestPath: string
): HlsManifestArtifactResponse | undefined {
  const pathname = parseRequestPath(requestPath);

  if (pathname === undefined) {
    return;
  }

  return artifacts.find((artifact) => artifact.path === pathname)?.response;
}

/**
 * Serves an LL-HLS playlist request end to end: parses the `_HLS_msn` /
 * `_HLS_part` parameters from `requestUrl`, resolves its pathname to the
 * master playlist or one rendition's media playlist, and renders only that
 * artifact. Unknown paths resolve as `not_found` immediately — they never
 * hold a waiter open. Master requests are served immediately; carrying
 * `_HLS_msn` / `_HLS_part` on the master path is `invalid` (RFC 8216bis
 * §6.2.5.1). Media requests resolve against the requested rendition's own
 * committed-window bounds: an `_HLS_msn` more than two beyond the
 * rendition's live edge is `invalid` (RFC 8216bis §6.2.5.2), otherwise the
 * request is held open via `waitForHlsBlockingReload` until the position is
 * committed or `timeoutMs` elapses. A `timeout` resolution still carries a
 * servable response rendered from the latest cursor. Malformed URLs or
 * parameters resolve as `invalid` rather than throwing.
 */
export async function resolveBlockingHlsManifestArtifactResponse(
  options: ResolveBlockingHlsManifestArtifactResponseOptions
): Promise<BlockingHlsManifestArtifactResponseResolution> {
  const request = parseBlockingReloadRequest(options.requestUrl);

  if (isInvalidParsedBlockingReloadRequest(request)) {
    return request;
  }

  const pathname = parseRequestPath(options.requestUrl);

  if (pathname === undefined) {
    return { status: "not_found" };
  }

  const target = resolveHlsManifestRequestTarget(
    options.session,
    options.manifest,
    pathname
  );

  if (target === undefined) {
    return { status: "not_found" };
  }

  if (target.kind === "master") {
    return resolveMasterManifestResponse(options, request);
  }

  return await resolveBlockingMediaManifestResponse(
    options,
    request,
    target.rendition
  );
}

/** The artifact a playlist request pathname addresses. */
type HlsManifestRequestTarget =
  | { kind: "master" }
  | { kind: "media"; rendition: Rendition };

// Resolves a request pathname to the master playlist or a rendition's media
// playlist using the same path resolution rendering uses (custom or default
// masterPath / mediaPlaylistPath, media playlists only for video and grouped
// audio renditions), so routing and rendering can never disagree.
function resolveHlsManifestRequestTarget(
  session: Session,
  manifestOptions: CreateHlsManifestArtifactsOptions,
  pathname: string
): HlsManifestRequestTarget | undefined {
  const masterPath = manifestOptions.masterPath ?? defaultMasterPath(session);

  if (pathname === masterPath) {
    return { kind: "master" };
  }

  const mediaPlaylistPath =
    manifestOptions.mediaPlaylistPath ?? defaultMediaPlaylistPath;
  const rendition = session.renditions.find(
    (candidate) =>
      isMediaPlaylistRendition(candidate) &&
      mediaPlaylistPath(session, candidate) === pathname
  );

  return rendition === undefined ? undefined : { kind: "media", rendition };
}

function resolveMasterManifestResponse(
  options: ResolveBlockingHlsManifestArtifactResponseOptions,
  request: HlsBlockingReloadRequest
): BlockingHlsManifestArtifactResponseResolution {
  // RFC 8216bis §6.2.5.1: delivery directives apply to media playlist
  // requests. A master playlist request carrying them is malformed, not a
  // reason to pin a waiter.
  if (
    request.mediaSequenceNumber !== undefined ||
    request.partNumber !== undefined
  ) {
    return {
      message: "_HLS_msn/_HLS_part apply to media playlist requests",
      status: "invalid",
    };
  }

  const availableRenditionIds = new Set(
    Object.keys(options.cursor.committedWindow.renditions)
  );

  if (!hasAvailableVideoRendition(options.session, availableRenditionIds)) {
    return { status: "not_found" };
  }

  const artifact = createMasterPlaylistArtifact(
    options.session,
    availableRenditionIds,
    options.manifest.mediaPlaylistPath ?? defaultMediaPlaylistPath,
    options.manifest.masterPath ?? defaultMasterPath(options.session)
  );

  return {
    cursor: options.cursor,
    response: createHlsManifestArtifactResponse(artifact, options.response),
    status: "ready",
  };
}

/**
 * RFC 8216bis §6.2.5.2: an `_HLS_msn` more than one segment beyond the
 * rendition's live edge cannot be a legitimate blocking reload — reject it
 * instead of holding the request open. Evaluated on the entry cursor only,
 * so exactly last + 2 still blocks.
 */
function isBeyondLiveEdge(
  request: HlsBlockingReloadRequest,
  lastMediaSequenceNumber: number
): boolean {
  return (
    request.mediaSequenceNumber !== undefined &&
    request.mediaSequenceNumber > lastMediaSequenceNumber + 2
  );
}

/**
 * Reasons the request cannot be held open at all: the rendition has nothing
 * committed yet, or `_HLS_msn` sits past the live edge.
 */
function refuseMediaManifestRequest(
  options: ResolveBlockingHlsManifestArtifactResponseOptions,
  request: HlsBlockingReloadRequest,
  rendition: Rendition
): BlockingHlsManifestArtifactResponseResolution | undefined {
  const bounds = renditionWindowBounds(
    options.cursor.committedWindow,
    rendition.renditionId
  );

  // A session rendition with no committed media has no playlist yet; its
  // route answers 404 until its first commit (Section 8.4).
  if (bounds === undefined) {
    return { status: "not_found" };
  }

  if (isBeyondLiveEdge(request, bounds.lastMediaSequenceNumber)) {
    return {
      message: "_HLS_msn is beyond the live edge",
      status: "invalid",
    };
  }

  return;
}

async function resolveBlockingMediaManifestResponse(
  options: ResolveBlockingHlsManifestArtifactResponseOptions,
  request: HlsBlockingReloadRequest,
  rendition: Rendition
): Promise<BlockingHlsManifestArtifactResponseResolution> {
  const refusal = refuseMediaManifestRequest(options, request, rendition);

  if (refusal !== undefined) {
    return refusal;
  }

  const wait = await waitForHlsBlockingReload({
    cursor: options.cursor,
    request: { ...request, renditionId: rendition.renditionId },
    timeoutMs: options.timeoutMs,
    waitForCursor: options.waitForCursor,
  });

  // A timeout is still servable: it renders from the latest cursor rather
  // than failing the request.
  return isServableBlockingReloadWait(wait)
    ? {
        cursor: wait.cursor,
        response: createSingleMediaPlaylistResponse(
          options.session,
          wait.cursor,
          rendition,
          options
        ),
        status: wait.status,
      }
    : wait;
}

// Renders only the requested rendition's playlist from the post-wait
// cursor, with the endOfStream default derived from that cursor's state.
function createSingleMediaPlaylistResponse(
  session: Session,
  cursor: Cursor,
  rendition: Rendition,
  options: ResolveBlockingHlsManifestArtifactResponseOptions
): HlsManifestArtifactResponse {
  const artifact = createMediaPlaylistArtifact(
    {
      committedWindow: cursor.committedWindow,
      mediaPlaylistPath:
        options.manifest.mediaPlaylistPath ?? defaultMediaPlaylistPath,
      options: {
        ...options.manifest,
        endOfStream:
          options.manifest.endOfStream ??
          isEndOfStreamSessionState(cursor.state),
      },
      session,
    },
    rendition
  );

  return createHlsManifestArtifactResponse(artifact, options.response);
}
