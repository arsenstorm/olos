import type { MediaSession, MediaTrack } from "../media/types";
import { assertMediaCursor, assertMediaSession } from "../media/validation";
import { isEndOfStreamSessionState } from "../state/session";
import type { CommittedWindow } from "../types/committed-window";
import type { Cursor } from "../types/cursor";
import type { Session } from "../types/session";
import {
  type CoordinatorHlsManifestOptions,
  type CoordinatorManifestArtifacts,
  type CreateCoordinatorManifestArtifactsOptions,
  type CreateHlsManifestArtifactsOptions,
  HLS_CONTENT_TYPE,
  type HlsManifestArtifact,
} from "./manifest-artifact-types";
import {
  defaultMasterPath,
  defaultMediaPlaylistPath,
} from "./manifest-request-parse";
import { renderMasterPlaylist } from "./master-playlist";
import {
  type RenderMediaPlaylistOptions,
  renderMediaPlaylist,
} from "./media-playlist";
import { assertSafeRelativePath } from "./uri";

/**
 * Renders the full playlist set for a session: the master playlist plus one
 * media playlist per video track and per grouped audio track (audio
 * tracks without a `groupId` stay muxed into the video variants and get
 * no standalone playlist). Tracks absent from the committed window (no
 * media commits yet) are excluded from both the master playlist and the
 * media-playlist set, so every advertised URI resolves; they appear on the
 * next render after their first commit. A window with no video track
 * yields no master artifact (master requests 404 until video media
 * commits). When `options.endOfStream` is unset, it defaults
 * to whether `session.state` is terminal (`ended` or `aborted`), which makes
 * the media playlists emit `#EXT-X-ENDLIST`. Throws if the session is not a
 * valid CMAF/LL-HLS media session or the paths or rendering options are
 * invalid.
 */
export function createHlsManifestArtifacts(
  session: Session,
  committedWindow: CommittedWindow,
  options: CreateHlsManifestArtifactsOptions
): HlsManifestArtifact[] {
  assertMediaSession(session);

  const masterPath = options.masterPath ?? defaultMasterPath(session);
  const mediaPlaylistPath =
    options.mediaPlaylistPath ?? defaultMediaPlaylistPath;
  const availableTrackIds = new Set(Object.keys(committedWindow.tracks));
  const master = hasAvailableVideoTrack(session, availableTrackIds)
    ? [
        createMasterPlaylistArtifact(
          session,
          availableTrackIds,
          mediaPlaylistPath,
          masterPath
        ),
      ]
    : [];

  return [
    ...master,
    ...createMediaPlaylistArtifacts(
      {
        committedWindow,
        mediaPlaylistPath,
        options: {
          ...options,
          endOfStream:
            options.endOfStream ?? isEndOfStreamSessionState(session.state),
        },
        session,
      },
      availableTrackIds
    ),
  ];
}

/**
 * Renders manifest artifacts from coordinator state. Returns an empty
 * artifact list when the state has no cursor yet (nothing committed).
 * `partTarget`, `segmentTarget`, and the discontinuity baseline are read
 * from the cursor's CMAF/LL-HLS profile, and — unlike
 * `createHlsManifestArtifacts` — the `endOfStream` default is derived from
 * the cursor's session state rather than `session.state`, so terminal
 * cursors emit `#EXT-X-ENDLIST` in the media playlists.
 */
export function createCoordinatorManifestArtifacts(
  options: CreateCoordinatorManifestArtifactsOptions
): CoordinatorManifestArtifacts {
  const cursor = options.state.cursor;

  if (cursor === undefined) {
    return { artifacts: [] };
  }

  const { state, ...manifestOptions } = options;

  return {
    artifacts: createHlsManifestArtifacts(
      state.session,
      cursor.committedWindow,
      {
        ...cursorManifestOptions(cursor, manifestOptions),
        endOfStream:
          manifestOptions.endOfStream ??
          isEndOfStreamSessionState(cursor.state),
      }
    ),
    cursor,
  };
}

/**
 * Completes coordinator manifest options with the timing targets carried by
 * the cursor's CMAF/LL-HLS session profile. Throws when the cursor does not
 * run the media profile.
 */
export function cursorManifestOptions(
  cursor: Cursor,
  options: CoordinatorHlsManifestOptions
): CreateHlsManifestArtifactsOptions {
  assertMediaCursor(cursor);

  return {
    ...options,
    ...mediaProfileRenderOptions(cursor),
  };
}

function mediaProfileRenderOptions(
  cursor: Cursor & { profile: MediaSession["profile"] }
): Pick<
  RenderMediaPlaylistOptions,
  "discontinuitySequence" | "partTarget" | "segmentTarget"
> {
  const { discontinuitySequence, partTarget, segmentTarget } = cursor.profile;

  return {
    ...(discontinuitySequence === undefined ? {} : { discontinuitySequence }),
    partTarget,
    segmentTarget,
  };
}

export function hasAvailableVideoTrack(
  session: MediaSession,
  availableTrackIds: ReadonlySet<string>
): boolean {
  const tracks: readonly MediaTrack[] = session.tracks;

  return tracks.some(
    (track) =>
      track.profile.kind === "video" && availableTrackIds.has(track.trackId)
  );
}

export function createMasterPlaylistArtifact(
  session: Session,
  availableTrackIds: ReadonlySet<string>,
  mediaPlaylistPath: NonNullable<
    CreateHlsManifestArtifactsOptions["mediaPlaylistPath"]
  >,
  masterPath: string
): HlsManifestArtifact {
  assertSafeRelativePath(masterPath, "master playlist path");

  return {
    body: renderMasterPlaylist(session, {
      availableTrackIds: [...availableTrackIds],
      mediaPlaylistPath,
    }),
    contentType: HLS_CONTENT_TYPE,
    path: masterPath,
  };
}

/**
 * Everything a media playlist needs except which track it is for. The
 * four fields are fixed for a whole render, so they travel as one value
 * rather than as four arguments repeated per track.
 */
export interface MediaPlaylistRenderContext {
  committedWindow: CommittedWindow;
  mediaPlaylistPath: NonNullable<
    CreateHlsManifestArtifactsOptions["mediaPlaylistPath"]
  >;
  options: CreateHlsManifestArtifactsOptions;
  session: Session;
}

function createMediaPlaylistArtifacts(
  context: MediaPlaylistRenderContext & { session: MediaSession },
  availableTrackIds: ReadonlySet<string>
): HlsManifestArtifact[] {
  const tracks: readonly MediaTrack[] = context.session.tracks;

  return tracks
    .filter(
      (track) =>
        isMediaPlaylistTrack(track) && availableTrackIds.has(track.trackId)
    )
    .map((track) => createMediaPlaylistArtifact(context, track));
}

export function createMediaPlaylistArtifact(
  context: MediaPlaylistRenderContext,
  track: MediaTrack
): HlsManifestArtifact {
  const path = context.mediaPlaylistPath(context.session, track);
  assertSafeRelativePath(path, "media playlist path");

  return {
    body: renderMediaPlaylist(context.committedWindow, {
      ...context.options,
      trackId: track.trackId,
    }),
    contentType: HLS_CONTENT_TYPE,
    path,
  };
}

// The session-shape half of the media-playlist predicate: video variants and
// grouped audio get standalone playlists — ungrouped audio keeps the legacy
// muxed-into-video rendering with no standalone playlist. Callers also
// require committed-window membership before rendering.
export function isMediaPlaylistTrack(track: MediaTrack): boolean {
  return (
    track.profile.kind === "video" ||
    (track.profile.kind === "audio" && track.profile.groupId !== undefined)
  );
}
