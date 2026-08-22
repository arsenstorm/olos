import type {
  CommittedObject,
  CommittedPart,
  CommittedSegment,
  TrackWindow,
} from "../types/committed-window";
import type { Cursor } from "../types/cursor";
import type { OlosId } from "../types/ids";
import type { Session, Track } from "../types/session";

/** Profile id of the CMAF / LL-HLS media profile. */
export const CMAF_LLHLS_PROFILE_ID = "cmaf-llhls";

/**
 * Media kinds a track can carry under the CMAF/LL-HLS profile.
 * `MediaTrackKind` is the derived union type.
 */
export const MEDIA_TRACK_KINDS = [
  "audio",
  "video",
  "text",
  "metadata",
] as const;

/** Media kind of a track: `audio`, `video`, `text`, or `metadata`. */
export type MediaTrackKind = (typeof MEDIA_TRACK_KINDS)[number];

/**
 * The CMAF/LL-HLS session profile: the timing targets every playlist,
 * publisher cadence, and hold-back derives from.
 */
// biome-ignore lint/style/useConsistentTypeDefinitions: a type literal gets an implicit index signature, so the profile is assignable to Core ProfileData; an interface is not
export type MediaSessionProfile = {
  /**
   * Baseline `EXT-X-DISCONTINUITY-SEQUENCE`; defaults to 0. Per-track
   * offsets for trimmed discontinuities are recorded by the track window
   * profile (see `mediaTrackWindowProfile`).
   */
  discontinuitySequence?: number;
  id: typeof CMAF_LLHLS_PROFILE_ID;
  /** Target part duration in seconds (`EXT-X-PART-INF` `PART-TARGET`). */
  partTarget: number;
  /** Target segment duration in seconds (`EXT-X-TARGETDURATION` source). */
  segmentTarget: number;
};

/**
 * The CMAF/LL-HLS track profile: one encoded variant of the session's
 * media. The audio-group fields (`groupId`, `name`, `defaultTrack`) are
 * only valid on audio tracks; `assertMediaSession` also enforces that
 * grouped audio shares a single group with at most one default.
 */
// biome-ignore lint/style/useConsistentTypeDefinitions: a type literal gets an implicit index signature, so the profile is assignable to Core ProfileData; an interface is not
export type MediaTrackProfile = {
  bitrate?: number;
  channels?: number;
  codec: string;
  /** Marks the default track of an audio group. Audio tracks only. */
  defaultTrack?: boolean;
  frameRate?: number;
  /** HLS audio group membership (EXT-X-MEDIA GROUP-ID). Audio tracks only. */
  groupId?: OlosId;
  height?: number;
  kind: MediaTrackKind;
  /** Human-readable EXT-X-MEDIA NAME. Audio tracks only. */
  name?: string;
  sampleRate?: number;
  width?: number;
};

/**
 * Per-object CMAF/LL-HLS profile data carried on slots, commits, and
 * committed objects.
 */
// biome-ignore lint/style/useConsistentTypeDefinitions: a type literal gets an implicit index signature, so the profile is assignable to Core ProfileData; an interface is not
export type MediaObjectProfile = {
  /** Emit `EXT-X-DISCONTINUITY` before this segment. Segments only. */
  discontinuityBefore?: boolean;
  /** Media duration in seconds. Required on segment and part objects. */
  duration?: number;
  /** Marks a part that starts with an independent (key) frame. */
  independent?: boolean;
  /** ISO 8601 wall-clock time of the media (EXT-X-PROGRAM-DATE-TIME). */
  programDateTime?: string;
};

/**
 * Track-window profile data produced by `mediaTrackWindowProfile`: the
 * number of discontinuities that have dropped off the front of the track's
 * window, on top of the session's baseline.
 */
// biome-ignore lint/style/useConsistentTypeDefinitions: a type literal gets an implicit index signature, so the profile is assignable to Core ProfileData; an interface is not
export type MediaTrackWindowProfile = {
  /** Rendered as the track's `EXT-X-DISCONTINUITY-SEQUENCE`. */
  discontinuitySequence: number;
};

/** A Core `Track` narrowed to the CMAF/LL-HLS profile. */
export type MediaTrack = Track & { profile: MediaTrackProfile };

/** A Core `Session` narrowed to the CMAF/LL-HLS profile. */
export type MediaSession = Session & {
  profile: MediaSessionProfile;
  tracks: MediaTrack[];
};

/** A Core `Cursor` narrowed to the CMAF/LL-HLS profile. */
export type MediaCursor = Cursor & { profile: MediaSessionProfile };

/** A committed object narrowed to the CMAF/LL-HLS profile. */
export type MediaCommittedObject = CommittedObject & {
  profile?: MediaObjectProfile;
};

/** A committed part narrowed to the CMAF/LL-HLS profile. */
export type MediaCommittedPart = CommittedPart & {
  profile?: MediaObjectProfile;
};

/** A committed segment narrowed to the CMAF/LL-HLS profile. */
export type MediaCommittedSegment = CommittedSegment & {
  parts?: MediaCommittedPart[];
  segment?: MediaCommittedObject;
};

/** A track window narrowed to the CMAF/LL-HLS profile. */
export type MediaTrackWindow = TrackWindow & {
  profile?: MediaTrackWindowProfile;
  segments: MediaCommittedSegment[];
};
