import {
  type CreateDeliveryCachePolicyOptions,
  createDeliveryCachePolicy,
} from "../state/cache-policy";
import type { CommittedWindow } from "../types/committed-window";
import type { Cursor } from "../types/cursor";
import type { Rendition, Session } from "../types/session";
import {
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
import { assertSafeRelativePath } from "./uri";

const HLS_CONTENT_TYPE = "application/vnd.apple.mpegurl";

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

export function createHlsManifestArtifacts(
  session: Session,
  committedWindow: CommittedWindow,
  options: CreateHlsManifestArtifactsOptions
): HlsManifestArtifact[] {
  const masterPath = options.masterPath ?? defaultMasterPath(session);
  const mediaPlaylistPath =
    options.mediaPlaylistPath ?? defaultMediaPlaylistPath;

  assertSafeRelativePath(masterPath, "master playlist path");

  const artifacts: HlsManifestArtifact[] = [
    {
      body: renderMasterPlaylist(session, { mediaPlaylistPath }),
      contentType: HLS_CONTENT_TYPE,
      path: masterPath,
    },
  ];

  for (const rendition of session.renditions) {
    if (rendition.kind !== "video") {
      continue;
    }

    const path = mediaPlaylistPath(session, rendition);
    assertSafeRelativePath(path, "media playlist path");

    artifacts.push({
      body: renderMediaPlaylist(committedWindow, {
        ...options,
        renditionId: rendition.renditionId,
      }),
      contentType: HLS_CONTENT_TYPE,
      path,
    });
  }

  return artifacts;
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

  if ("status" in request) {
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
):
  | ReturnType<typeof parseHlsBlockingReloadRequest>
  | { message: string; status: "invalid" } {
  try {
    return parseHlsBlockingReloadRequest(requestUrl);
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "invalid request URL",
      status: "invalid",
    };
  }
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
  if (value.startsWith("/")) {
    return new URL(value, "https://olos.local").pathname;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return;
    }

    return url.pathname;
  } catch {
    return;
  }
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
