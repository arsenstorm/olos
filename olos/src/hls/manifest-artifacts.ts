import { isEndOfStreamSessionState } from "../state/session";
import type { CommittedWindow } from "../types/committed-window";
import type { Rendition, Session } from "../types/session";
import {
  type CoordinatorManifestArtifacts,
  type CreateCoordinatorManifestArtifactsOptions,
  type CreateHlsManifestArtifactsOptions,
  HLS_CONTENT_TYPE,
  type HlsManifestArtifact,
} from "./manifest-artifact-types";
import {
  defaultMasterPath,
  defaultMediaPlaylistPath,
} from "./manifest-response";
import { renderMasterPlaylist } from "./master-playlist";
import { renderMediaPlaylist } from "./media-playlist";
import { assertSafeRelativePath } from "./uri";
/**
 * Renders the full playlist set for a session: the master playlist plus one
 * media playlist per video rendition and per grouped audio rendition (audio
 * renditions without a `groupId` stay muxed into the video variants and get
 * no standalone playlist). Renditions absent from the committed window (no
 * media commits yet) are excluded from both the master playlist and the
 * media-playlist set, so every advertised URI resolves; they appear on the
 * next render after their first commit. A window with no video rendition
 * yields no master artifact (master requests 404 until video media
 * commits). When `options.endOfStream` is unset, it defaults
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
  const availableRenditionIds = new Set(
    Object.keys(committedWindow.renditions)
  );
  const master = hasAvailableVideoRendition(session, availableRenditionIds)
    ? [
        createMasterPlaylistArtifact(
          session,
          availableRenditionIds,
          mediaPlaylistPath,
          masterPath
        ),
      ]
    : [];

  return [
    ...master,
    ...createMediaPlaylistArtifacts(
      session,
      committedWindow,
      availableRenditionIds,
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

export function hasAvailableVideoRendition(
  session: Session,
  availableRenditionIds: ReadonlySet<string>
): boolean {
  return session.renditions.some(
    (rendition) =>
      rendition.kind === "video" &&
      availableRenditionIds.has(rendition.renditionId)
  );
}

export function createMasterPlaylistArtifact(
  session: Session,
  availableRenditionIds: ReadonlySet<string>,
  mediaPlaylistPath: NonNullable<
    CreateHlsManifestArtifactsOptions["mediaPlaylistPath"]
  >,
  masterPath: string
): HlsManifestArtifact {
  assertSafeRelativePath(masterPath, "master playlist path");

  return {
    body: renderMasterPlaylist(session, {
      availableRenditionIds: [...availableRenditionIds],
      mediaPlaylistPath,
    }),
    contentType: HLS_CONTENT_TYPE,
    path: masterPath,
  };
}

function createMediaPlaylistArtifacts(
  session: Session,
  committedWindow: CommittedWindow,
  availableRenditionIds: ReadonlySet<string>,
  mediaPlaylistPath: NonNullable<
    CreateHlsManifestArtifactsOptions["mediaPlaylistPath"]
  >,
  options: CreateHlsManifestArtifactsOptions
): HlsManifestArtifact[] {
  return session.renditions
    .filter(
      (rendition) =>
        isMediaPlaylistRendition(rendition) &&
        availableRenditionIds.has(rendition.renditionId)
    )
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

export function createMediaPlaylistArtifact(
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

// The session-shape half of the media-playlist predicate: video variants and
// grouped audio get standalone playlists — ungrouped audio keeps the legacy
// muxed-into-video rendering with no standalone playlist. Callers also
// require committed-window membership before rendering.
export function isMediaPlaylistRendition(rendition: Rendition): boolean {
  return (
    rendition.kind === "video" ||
    (rendition.kind === "audio" && rendition.groupId !== undefined)
  );
}
