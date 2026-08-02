import {
  type CreateDeliveryCachePolicyOptions,
  createDeliveryCachePolicy,
} from "../state/cache-policy";
import type { CommittedWindow } from "../types/committed-window";
import type { Cursor } from "../types/cursor";
import type { Rendition, Session, SessionState } from "../types/session";
import {
  type HlsBlockingReloadRequest,
  parseHlsBlockingReloadRequest,
  type WaitForHlsBlockingReloadOptions,
  waitForHlsBlockingReload,
} from "./blocking-reload";
import {
  type RenderMasterPlaylistOptions,
  renderMasterPlaylist,
} from "./master-playlist";
import {
  type RenderMediaPlaylistOptions,
  renderMediaPlaylist,
} from "./media-playlist";
import { assertSafeRelativePath, HLS_RELATIVE_REQUEST_BASE_URL } from "./uri";

const HLS_CONTENT_TYPE = "application/vnd.apple.mpegurl";
const HLS_TEXT_ERROR_CONTENT_TYPE = "text/plain; charset=utf-8";

/**
 * A rendered HLS playlist ready for delivery: the playlist text, the
 * `application/vnd.apple.mpegurl` content type, and the request path it
 * should be served under.
 */
export interface HlsManifestArtifact {
  body: string;
  contentType: typeof HLS_CONTENT_TYPE;
  /** Root-relative request path, e.g. `/v1/live/{sessionId}/master.m3u8`. */
  path: string;
}

/**
 * Transport-agnostic HTTP response for a manifest artifact: the playlist body
 * plus `content-type` and `cache-control` headers. Convert it to a Fetch
 * `Response` with `createHlsManifestWebResponse`.
 */
export interface HlsManifestArtifactResponse {
  body: string;
  headers: Record<string, string>;
  status: 200;
}

/** A manifest artifact paired with its prebuilt HTTP response. */
export interface HlsManifestResponseArtifact extends HlsManifestArtifact {
  response: HlsManifestArtifactResponse;
}

/**
 * Cache policy overrides for manifest responses. Inherits the delivery cache
 * policy options with the target fixed to `manifest`.
 */
export interface CreateHlsManifestArtifactResponseOptions
  extends Omit<CreateDeliveryCachePolicyOptions, "target"> {}

/**
 * Options for `createHlsManifestArtifacts`: the media playlist rendering
 * options (applied to every rendition) plus the delivery paths for the
 * generated playlists.
 */
export interface CreateHlsManifestArtifactsOptions
  extends Omit<RenderMediaPlaylistOptions, "renditionId"> {
  /**
   * Path for the master playlist. Defaults to
   * `/v1/live/{sessionId}/master.m3u8`.
   */
  masterPath?: string;
  /**
   * Maps a rendition to its media playlist path. Defaults to
   * `/v1/live/{sessionId}/{renditionId}/media.m3u8`. Paths must be safe
   * root-relative paths.
   */
  mediaPlaylistPath?: RenderMasterPlaylistOptions["mediaPlaylistPath"];
}

/**
 * Options for `createCoordinatorManifestArtifacts`: the manifest options plus
 * the coordinator state to render from.
 */
export interface CreateCoordinatorManifestArtifactsOptions
  extends CreateHlsManifestArtifactsOptions {
  state: {
    /** Latest coordinator cursor; omit when no commits have landed yet. */
    cursor?: Cursor;
    session: Session;
  };
}

/**
 * Result of `createCoordinatorManifestArtifacts`: the rendered playlists and
 * the cursor they were rendered from. `artifacts` is empty and `cursor` is
 * absent when the coordinator state has no cursor yet.
 */
export interface CoordinatorManifestArtifacts {
  artifacts: readonly HlsManifestArtifact[];
  /** The cursor the artifacts reflect; absent when nothing was rendered. */
  cursor?: Cursor;
}

/** Options for `resolveBlockingHlsManifestArtifactResponse`. */
export interface ResolveBlockingHlsManifestArtifactResponseOptions {
  /** The cursor to start resolving against. */
  cursor: Cursor;
  /** Rendering options used to build the playlists once the wait resolves. */
  manifest: CreateHlsManifestArtifactsOptions;
  /**
   * The playlist request URL, including any `_HLS_msn` / `_HLS_part` query
   * parameters. Its pathname selects which artifact to serve.
   */
  requestUrl: string;
  /** Cache policy overrides for the manifest response. */
  response?: CreateHlsManifestArtifactResponseOptions;
  session: Session;
  /** Maximum time to hold the blocking reload open, in milliseconds. */
  timeoutMs: number;
  /** Resolves with a newer cursor once the session advances. */
  waitForCursor: WaitForHlsBlockingReloadOptions["waitForCursor"];
}

/**
 * Outcome of `resolveBlockingHlsManifestArtifactResponse`: `ready` or
 * `timeout` with a servable response and the cursor it was rendered from,
 * `not_found` when the request path matches no artifact, or `invalid` for a
 * malformed request URL or blocking reload parameters.
 */
export type BlockingHlsManifestArtifactResponseResolution =
  | {
      cursor: Cursor;
      response: HlsManifestArtifactResponse;
      status: "ready" | "timeout";
    }
  | {
      status: "not_found";
    }
  | {
      message: string;
      status: "invalid";
    };

/**
 * The error subset of a blocking manifest resolution (`invalid` or
 * `not_found`), accepted by `createHlsManifestErrorWebResponse`.
 */
export type HlsManifestErrorResolution = Extract<
  BlockingHlsManifestArtifactResponseResolution,
  { status: "invalid" | "not_found" }
>;

type InvalidParsedBlockingReloadRequest = Extract<
  BlockingHlsManifestArtifactResponseResolution,
  { status: "invalid" }
>;

type ParsedBlockingReloadRequest =
  | HlsBlockingReloadRequest
  | InvalidParsedBlockingReloadRequest;

type ServableBlockingReloadWait = Extract<
  Awaited<ReturnType<typeof waitForHlsBlockingReload>>,
  { status: "ready" | "timeout" }
>;

/**
 * Renders the full playlist set for a session: the master playlist plus one
 * media playlist per video rendition and per grouped audio rendition (audio
 * renditions without a `groupId` stay muxed into the video variants and get
 * no standalone playlist). When `options.endOfStream` is unset, it defaults
 * to whether `session.state` is terminal (`ended` or `aborted`), which makes
 * the media playlists emit `#EXT-X-ENDLIST`. Throws if the session shape,
 * paths, or rendering options are invalid.
 */
export function createHlsManifestArtifacts(
  session: Session,
  committedWindow: CommittedWindow,
  options: CreateHlsManifestArtifactsOptions
): HlsManifestArtifact[] {
  const masterPath = options.masterPath ?? defaultMasterPath(session);
  const mediaPlaylistPath =
    options.mediaPlaylistPath ?? defaultMediaPlaylistPath;

  return [
    createMasterPlaylistArtifact(session, mediaPlaylistPath, masterPath),
    ...createMediaPlaylistArtifacts(
      session,
      committedWindow,
      mediaPlaylistPath,
      {
        ...options,
        endOfStream:
          options.endOfStream ?? isEndOfStreamSessionState(session.state),
      }
    ),
  ];
}

/**
 * Renders manifest artifacts from coordinator state. Returns an empty
 * artifact list when the state has no cursor yet (nothing committed).
 * Unlike `createHlsManifestArtifacts`, the `endOfStream` default is derived
 * from the cursor's session state rather than `session.state`, so terminal
 * cursors emit `#EXT-X-ENDLIST` in the media playlists.
 */
export function createCoordinatorManifestArtifacts(
  options: CreateCoordinatorManifestArtifactsOptions
): CoordinatorManifestArtifacts {
  const cursor = options.state.cursor;

  if (cursor === undefined) {
    return { artifacts: [] };
  }

  const { state, ...artifactOptions } = options;

  return {
    artifacts: createHlsManifestArtifacts(
      state.session,
      cursor.committedWindow,
      {
        ...artifactOptions,
        endOfStream:
          artifactOptions.endOfStream ??
          isEndOfStreamSessionState(cursor.state),
      }
    ),
    cursor,
  };
}

/**
 * Whether a session state is terminal (`ended` or `aborted`) and its media
 * playlists should therefore emit `#EXT-X-ENDLIST`. Cursor-aware callers pass
 * the cursor's state; direct callers fall back to the session's state.
 */
export function isEndOfStreamSessionState(state: SessionState): boolean {
  return state === "ended" || state === "aborted";
}

function createMasterPlaylistArtifact(
  session: Session,
  mediaPlaylistPath: NonNullable<
    CreateHlsManifestArtifactsOptions["mediaPlaylistPath"]
  >,
  masterPath: string
): HlsManifestArtifact {
  assertSafeRelativePath(masterPath, "master playlist path");

  return {
    body: renderMasterPlaylist(session, { mediaPlaylistPath }),
    contentType: HLS_CONTENT_TYPE,
    path: masterPath,
  };
}

function createMediaPlaylistArtifacts(
  session: Session,
  committedWindow: CommittedWindow,
  mediaPlaylistPath: NonNullable<
    CreateHlsManifestArtifactsOptions["mediaPlaylistPath"]
  >,
  options: CreateHlsManifestArtifactsOptions
): HlsManifestArtifact[] {
  return session.renditions
    .filter(isMediaPlaylistRendition)
    .map((rendition) =>
      createMediaPlaylistArtifact(
        session,
        committedWindow,
        rendition,
        mediaPlaylistPath,
        options
      )
    );
}

function createMediaPlaylistArtifact(
  session: Session,
  committedWindow: CommittedWindow,
  rendition: Rendition,
  mediaPlaylistPath: NonNullable<
    CreateHlsManifestArtifactsOptions["mediaPlaylistPath"]
  >,
  options: CreateHlsManifestArtifactsOptions
): HlsManifestArtifact {
  const path = mediaPlaylistPath(session, rendition);
  assertSafeRelativePath(path, "media playlist path");

  return {
    body: renderMediaPlaylist(committedWindow, {
      ...options,
      renditionId: rendition.renditionId,
    }),
    contentType: HLS_CONTENT_TYPE,
    path,
  };
}

// Video variants always get a media playlist. Audio renditions only get one
// once they join an audio group (groupId) — ungrouped audio keeps the legacy
// muxed-into-video rendering with no standalone playlist.
function isMediaPlaylistRendition(rendition: Rendition): boolean {
  return (
    rendition.kind === "video" ||
    (rendition.kind === "audio" && rendition.groupId !== undefined)
  );
}

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
 * `_HLS_part` parameters from `requestUrl`, holds the request open via
 * `waitForHlsBlockingReload` until the requested position is committed or
 * `timeoutMs` elapses, renders the playlists from the resulting cursor, and
 * matches the request path against them. A `timeout` resolution still
 * carries a servable response rendered from the latest cursor. Malformed
 * URLs or parameters resolve as `invalid` rather than throwing.
 */
export async function resolveBlockingHlsManifestArtifactResponse(
  options: ResolveBlockingHlsManifestArtifactResponseOptions
): Promise<BlockingHlsManifestArtifactResponseResolution> {
  const request = parseBlockingReloadRequest(options.requestUrl);

  if (isInvalidParsedBlockingReloadRequest(request)) {
    return request;
  }

  const wait = await waitForHlsBlockingReload({
    cursor: options.cursor,
    request,
    timeoutMs: options.timeoutMs,
    waitForCursor: options.waitForCursor,
  });

  if (!isServableBlockingReloadWait(wait)) {
    return wait;
  }

  return blockingHlsManifestArtifactResponseResolution(options, wait);
}

function blockingHlsManifestArtifactResponseResolution(
  options: ResolveBlockingHlsManifestArtifactResponseOptions,
  wait: ServableBlockingReloadWait
): BlockingHlsManifestArtifactResponseResolution {
  const response = resolveHlsManifestArtifactResponse(
    createResponseArtifacts(options.session, wait.cursor, options),
    options.requestUrl
  );

  if (!response) {
    return { status: "not_found" };
  }

  return {
    cursor: wait.cursor,
    response,
    status: wait.status,
  };
}

function parseBlockingReloadRequest(
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

function isInvalidParsedBlockingReloadRequest(
  request: ParsedBlockingReloadRequest
): request is InvalidParsedBlockingReloadRequest {
  return "status" in request;
}

function isServableBlockingReloadWait(
  wait: Awaited<ReturnType<typeof waitForHlsBlockingReload>>
): wait is ServableBlockingReloadWait {
  return wait.status === "ready" || wait.status === "timeout";
}

function defaultMasterPath(session: Session): string {
  return `/v1/live/${session.sessionId}/master.m3u8`;
}

function defaultMediaPlaylistPath(
  session: Session,
  rendition: Rendition
): string {
  return `/v1/live/${session.sessionId}/${rendition.renditionId}/media.m3u8`;
}

function parseRequestPath(value: string): string | undefined {
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

function createResponseArtifacts(
  session: Session,
  cursor: Cursor,
  options: ResolveBlockingHlsManifestArtifactResponseOptions
): HlsManifestResponseArtifact[] {
  return createHlsManifestArtifacts(session, cursor.committedWindow, {
    ...options.manifest,
    endOfStream:
      options.manifest.endOfStream ?? isEndOfStreamSessionState(cursor.state),
  }).map((artifact) => ({
    ...artifact,
    response: createHlsManifestArtifactResponse(artifact, options.response),
  }));
}

function createHlsTextErrorWebResponse(
  body: string,
  status: 400 | 404
): Response {
  return new Response(body, {
    headers: { "content-type": HLS_TEXT_ERROR_CONTENT_TYPE },
    status,
  });
}
