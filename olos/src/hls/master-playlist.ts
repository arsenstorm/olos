import type {
  MediaSession,
  MediaTrack,
  MediaTrackProfile,
} from "../media/types";
import { assertMediaSession } from "../media/validation";
import type { Session, Track } from "../types/session";
import {
  defaultMediaPlaylistPath,
  distinct,
  isAudioTrack,
  isGroupedAudioTrack,
  isVideoTrack,
  renderAudioGroupEntries,
  renderVariantEntry,
} from "./master-playlist-tracks";

/** Options for `renderMasterPlaylist`. */
export interface RenderMasterPlaylistOptions {
  /**
   * When set, only video and grouped-audio tracks whose id is in this
   * set render as variants or `#EXT-X-MEDIA` entries — typically the
   * track ids present in the committed window, so the master only
   * advertises playlists that resolve. Ungrouped (muxed) audio tracks
   * are codec metadata and are never filtered. Omitted, every session
   * track renders.
   */
  availableTrackIds?: readonly string[];
  /**
   * Maps a track to the media playlist path written into the playlist.
   * Defaults to `/v1/live/{sessionId}/{trackId}/media.m3u8`. Paths must
   * be safe root-relative paths.
   */
  mediaPlaylistPath?: (session: Session, track: Track) => string;
}

export type AudioTrack = MediaTrack & {
  profile: MediaTrackProfile & { kind: "audio" };
};
export type GroupedAudioTrack = AudioTrack & {
  profile: AudioTrack["profile"] & { groupId: string };
};
export type VideoTrack = MediaTrack & {
  profile: MediaTrackProfile & { kind: "video" };
};

export interface AudioGroup {
  defaultTrackId: string;
  groupId: string;
  tracks: readonly GroupedAudioTrack[];
}

export interface MasterPlaylistTracks {
  audioGroup?: AudioGroup;
  variantAudioCodecs: readonly string[];
  videoTracks: readonly VideoTrack[];
}

/**
 * Renders the session's master (multivariant) playlist with one
 * `#EXT-X-STREAM-INF` entry per video track. Audio tracks that
 * declare a `groupId` render as selectable `#EXT-X-MEDIA` entries and the
 * variants reference the group through their `AUDIO` attribute; without
 * group IDs, every audio codec is folded into every variant's `CODECS`
 * attribute (legacy muxed audio) and no `#EXT-X-MEDIA` lines are emitted.
 * `availableTrackIds` narrows the rendered set (the session is validated
 * as a CMAF/LL-HLS media session in full first, including the audio-group
 * rules). Throws when the session is not a valid media session, there is
 * no video track, a video track lacks `bitrate`, or the filter removes
 * every video track.
 */
export function renderMasterPlaylist(
  session: Session,
  options: RenderMasterPlaylistOptions = {}
): string {
  assertMediaSession(session);

  const tracks = masterPlaylistTracks(session, options.availableTrackIds);
  const mediaPlaylistPath =
    options.mediaPlaylistPath ?? defaultMediaPlaylistPath;
  const lines = ["#EXTM3U", "#EXT-X-VERSION:10", "#EXT-X-INDEPENDENT-SEGMENTS"];

  lines.push(...renderAudioGroupEntries(session, tracks, mediaPlaylistPath));

  for (const track of tracks.videoTracks) {
    lines.push(
      ...renderVariantEntry(session, track, tracks, mediaPlaylistPath)
    );
  }

  return `${lines.join("\n")}\n`;
}

function masterPlaylistTracks(
  session: MediaSession,
  availableTrackIds?: readonly string[]
): MasterPlaylistTracks {
  const audioTracks = session.tracks.filter(isAudioTrack);
  const videoTracks = session.tracks.filter(isVideoTrack);

  if (videoTracks.length === 0) {
    throw new Error("session.tracks must include at least one video track");
  }

  // The audio group is resolved from the full session; the availability
  // filter below only narrows what renders.
  const audioGroup = resolveAudioGroup(audioTracks);

  if (availableTrackIds === undefined) {
    return {
      audioGroup,
      variantAudioCodecs: audioGroup
        ? distinct(audioGroup.tracks.map((track) => track.profile.codec))
        : audioTracks.map((track) => track.profile.codec),
      videoTracks,
    };
  }

  return availablePlaylistTracks(new Set(availableTrackIds), {
    audioGroup,
    audioTracks,
    videoTracks,
  });
}

/** Narrow the validated track set to what the window actually carries. */
function availablePlaylistTracks(
  available: ReadonlySet<string>,
  all: {
    audioGroup: MasterPlaylistTracks["audioGroup"];
    audioTracks: readonly AudioTrack[];
    videoTracks: readonly VideoTrack[];
  }
): MasterPlaylistTracks {
  const availableVideoTracks = all.videoTracks.filter((track) =>
    available.has(track.trackId)
  );

  if (availableVideoTracks.length === 0) {
    throw new Error("no video track is available to render");
  }

  const availableAudioGroup = filterAudioGroup(all.audioGroup, available);

  return {
    audioGroup: availableAudioGroup,
    variantAudioCodecs: resolveVariantAudioCodecs(
      all.audioGroup,
      availableAudioGroup,
      all.audioTracks
    ),
    videoTracks: availableVideoTracks,
  };
}

// The session-elected default keeps its seat even when unavailable: members
// then render DEFAULT=NO,AUTOSELECT=NO (spec-legal) rather than electing a
// temporary default that would flip back once the elected one commits.
function filterAudioGroup(
  group: AudioGroup | undefined,
  available: ReadonlySet<string>
): AudioGroup | undefined {
  if (group === undefined) {
    return;
  }

  const tracks = group.tracks.filter((track) => available.has(track.trackId));

  if (tracks.length === 0) {
    return;
  }

  return {
    defaultTrackId: group.defaultTrackId,
    groupId: group.groupId,
    tracks,
  };
}

function resolveVariantAudioCodecs(
  audioGroup: AudioGroup | undefined,
  availableAudioGroup: AudioGroup | undefined,
  audioTracks: readonly AudioTrack[]
): readonly string[] {
  if (audioGroup === undefined) {
    return audioTracks.map((track) => track.profile.codec);
  }

  return availableAudioGroup === undefined
    ? []
    : distinct(availableAudioGroup.tracks.map((r) => r.profile.codec));
}

// No groupId anywhere means legacy rendering: audio codecs muxed into each
// variant's CODECS and no EXT-X-MEDIA. Grouping invariants (no mixing, one
// group, one default, distinct names) are enforced by `assertMediaSession`.
function resolveAudioGroup(
  audioTracks: readonly AudioTrack[]
): AudioGroup | undefined {
  const grouped = audioTracks.filter(isGroupedAudioTrack);
  const [first] = grouped;

  if (first === undefined) {
    return;
  }

  const defaultTrack =
    grouped.find((track) => track.profile.defaultTrack === true) ?? first;

  return {
    defaultTrackId: defaultTrack.trackId,
    groupId: first.profile.groupId,
    tracks: grouped,
  };
}
