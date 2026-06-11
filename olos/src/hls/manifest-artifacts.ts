import {
  type CreateDeliveryCachePolicyOptions,
  createDeliveryCachePolicy,
} from "../state/cache-policy";
import type { CommittedWindow } from "../types/committed-window";
import type { Rendition, Session } from "../types/session";
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

export interface CreateHlsManifestArtifactResponseOptions
  extends Omit<CreateDeliveryCachePolicyOptions, "target"> {}

export interface CreateHlsManifestArtifactsOptions
  extends Omit<RenderMediaPlaylistOptions, "renditionId"> {
  masterPath?: string;
  mediaPlaylistPath?: RenderMasterPlaylistOptions["mediaPlaylistPath"];
}

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

function defaultMasterPath(session: Session): string {
  return `/v1/live/${session.sessionId}/master.m3u8`;
}

function defaultMediaPlaylistPath(
  session: Session,
  rendition: Rendition
): string {
  return `/v1/live/${session.sessionId}/${rendition.renditionId}/media.m3u8`;
}
