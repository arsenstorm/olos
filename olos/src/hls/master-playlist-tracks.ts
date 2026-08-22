import type { MediaTrack } from "../media/types";
import type { Session, Track } from "../types/session";
import { formatFrameRate, quotedPlaylistValue } from "./format";
import type {
  AudioGroup,
  AudioTrack,
  GroupedAudioTrack,
  MasterPlaylistTracks,
  VideoTrack,
} from "./master-playlist";
import { assertSafeRelativePath } from "./uri";

export function renderAudioGroupEntries(
  session: Session,
  tracks: MasterPlaylistTracks,
  mediaPlaylistPath: (session: Session, track: Track) => string
): string[] {
  const group = tracks.audioGroup;

  if (group === undefined) {
    return [];
  }

  return group.tracks.map((track) =>
    renderAudioMediaEntry(session, track, group, mediaPlaylistPath)
  );
}

function renderAudioMediaEntry(
  session: Session,
  track: GroupedAudioTrack,
  group: AudioGroup,
  mediaPlaylistPath: (session: Session, track: Track) => string
): string {
  const path = mediaPlaylistPath(session, track);
  assertSafeRelativePath(path, "media playlist path");

  const attributes = [
    "TYPE=AUDIO",
    `GROUP-ID="${quotedPlaylistValue(group.groupId, "audio group id")}"`,
    `NAME="${quotedPlaylistValue(
      track.profile.name ?? track.trackId,
      `track ${track.trackId} name`
    )}"`,
    `DEFAULT=${track.trackId === group.defaultTrackId ? "YES" : "NO"}`,
    // RFC 8216 §4.3.4.1.1: AUTOSELECT=YES members of a group must be
    // distinct on LANGUAGE/ASSOC-LANGUAGE/FORCED/CHARACTERISTICS. Tracks
    // carry none of those attributes, so only the default may auto-select.
    `AUTOSELECT=${track.trackId === group.defaultTrackId ? "YES" : "NO"}`,
    ...channelsAttributes(track),
    `URI="${quotedPlaylistValue(path, "media playlist path")}"`,
  ];

  return `#EXT-X-MEDIA:${attributes.join(",")}`;
}

function channelsAttributes(track: AudioTrack): string[] {
  const { channels } = track.profile;

  return channels === undefined ? [] : [`CHANNELS="${channels}"`];
}

export function renderVariantEntry(
  session: Session,
  track: VideoTrack,
  tracks: MasterPlaylistTracks,
  mediaPlaylistPath: (session: Session, track: Track) => string
): string[] {
  const path = mediaPlaylistPath(session, track);
  assertSafeRelativePath(path, "media playlist path");

  return [`#EXT-X-STREAM-INF:${renderStreamAttributes(track, tracks)}`, path];
}

function renderStreamAttributes(
  track: VideoTrack,
  tracks: MasterPlaylistTracks
): string {
  const bandwidth = requiredBandwidth(track);

  const attributes = [
    `BANDWIDTH=${bandwidth}`,
    `AVERAGE-BANDWIDTH=${bandwidth}`,
    codecsAttribute(track, tracks.variantAudioCodecs),
    ...resolutionAttributes(track),
    ...frameRateAttributes(track),
    ...audioGroupAttributes(tracks.audioGroup),
  ];

  return attributes.join(",");
}

function audioGroupAttributes(group: AudioGroup | undefined): string[] {
  return group === undefined
    ? []
    : [`AUDIO="${quotedPlaylistValue(group.groupId, "audio group id")}"`];
}

function requiredBandwidth(track: VideoTrack): number {
  const bandwidth = track.profile.bitrate;

  if (!bandwidth) {
    throw new Error(`track ${track.trackId} must define bitrate`);
  }

  return bandwidth;
}

function codecsAttribute(
  track: VideoTrack,
  audioCodecs: readonly string[]
): string {
  return `CODECS="${quotedPlaylistValue(
    [track.profile.codec, ...audioCodecs].join(","),
    `track ${track.trackId} codecs`
  )}"`;
}

function frameRateAttributes(track: VideoTrack): string[] {
  const { frameRate } = track.profile;

  return frameRate === undefined
    ? []
    : [`FRAME-RATE=${formatFrameRate(frameRate)}`];
}

// `assertMediaTrackProfile` guarantees width and height are set together.
function resolutionAttributes(track: VideoTrack): string[] {
  const { height, width } = track.profile;

  if (width === undefined || height === undefined) {
    return [];
  }

  return [`RESOLUTION=${width}x${height}`];
}

export function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function isAudioTrack(track: MediaTrack): track is AudioTrack {
  return track.profile.kind === "audio";
}

export function isGroupedAudioTrack(
  track: AudioTrack
): track is GroupedAudioTrack {
  return track.profile.groupId !== undefined;
}

export function isVideoTrack(track: MediaTrack): track is VideoTrack {
  return track.profile.kind === "video";
}
