import {
  type CreateDeliveryCachePolicyOptions,
  createDeliveryCachePolicy,
} from "../state/cache-policy";
import type { CommittedWindow } from "../types/committed-window";
import type { Cursor } from "../types/cursor";
import type { Rendition, Session } from "../types/session";
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

export interface HlsManifestArtifact {
  body: string;
  contentType: typeof HLS_CONTENT_TYPE;
  path: string;
}

export interface HlsManifestArtifactResponse {
  body: string;
  headers: Record<string, string>;
  status: 200;
}

export interface HlsManifestResponseArtifact extends HlsManifestArtifact {
  response: HlsManifestArtifactResponse;
}

export interface CreateHlsManifestArtifactResponseOptions
  extends Omit<CreateDeliveryCachePolicyOptions, "target"> {}

export interface CreateHlsManifestArtifactsOptions
  extends Omit<RenderMediaPlaylistOptions, "renditionId"> {
  masterPath?: string;
  mediaPlaylistPath?: RenderMasterPlaylistOptions["mediaPlaylistPath"];
}

export interface ResolveBlockingHlsManifestArtifactResponseOptions {
  cursor: Cursor;
  manifest: CreateHlsManifestArtifactsOptions;
  requestUrl: string;
  response?: CreateHlsManifestArtifactResponseOptions;
  session: Session;
  timeoutMs: number;
  waitForCursor: WaitForHlsBlockingReloadOptions["waitForCursor"];
}

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

export type HlsManifestErrorResolution = Extract<
  BlockingHlsManifestArtifactResponseResolution,
  { status: "invalid" | "not_found" }
>;

type InvalidParsedBlockingReloadRequest = Extract<
  BlockingHlsManifestArtifactResponseResolution,
  { status: "invalid" }
>;

type NotFoundHlsManifestArtifactResponseResolution = Extract<
  BlockingHlsManifestArtifactResponseResolution,
  { status: "not_found" }
>;

type VideoRendition = Rendition & { kind: "video" };

type ParsedBlockingReloadRequest =
  | HlsBlockingReloadRequest
  | InvalidParsedBlockingReloadRequest;

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
      options
    ),
  ];
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
    .filter(isVideoRendition)
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
  rendition: VideoRendition,
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

function isVideoRendition(rendition: Rendition): rendition is VideoRendition {
  return rendition.kind === "video";
}

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

export function createHlsManifestWebResponse(
  response: HlsManifestArtifactResponse
): Response {
  return new Response(response.body, {
    headers: response.headers,
    status: response.status,
  });
}

export function createHlsManifestErrorWebResponse(
  resolution: HlsManifestErrorResolution
): Response {
  if (resolution.status === "invalid") {
    return createHlsTextErrorWebResponse(resolution.message, 400);
  }

  return createHlsTextErrorWebResponse("manifest not found", 404);
}

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

  if (wait.status === "invalid") {
    return wait;
  }

  return blockingHlsManifestArtifactResponseResolution(options, wait);
}

function blockingHlsManifestArtifactResponseResolution(
  options: ResolveBlockingHlsManifestArtifactResponseOptions,
  wait: Extract<
    Awaited<ReturnType<typeof waitForHlsBlockingReload>>,
    { status: "ready" | "timeout" }
  >
): BlockingHlsManifestArtifactResponseResolution {
  const response = resolveHlsManifestArtifactResponse(
    createResponseArtifacts(options.session, wait.cursor, options),
    options.requestUrl
  );

  if (!response) {
    return notFoundHlsManifestArtifactResponseResolution();
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

function notFoundHlsManifestArtifactResponseResolution(): NotFoundHlsManifestArtifactResponseResolution {
  return { status: "not_found" };
}

function isInvalidParsedBlockingReloadRequest(
  request: ParsedBlockingReloadRequest
): request is InvalidParsedBlockingReloadRequest {
  return "status" in request;
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
  return createHlsManifestArtifacts(
    session,
    cursor.committedWindow,
    options.manifest
  ).map((artifact) => ({
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
