import type { CommittedSegment } from "../types/committed-window";
import type { Cursor } from "../types/cursor";
import type { ProfileData } from "../types/profile";
import type { Track } from "../types/session";
import {
  assertBooleanField,
  assertIsoDateField,
  assertNonEmptyStringField,
  assertNonNegativeIntegerField,
  assertOneOfField,
  assertOnlyKnownFields,
  assertPositiveIntegerField,
  assertPositiveNumberField,
  assertUrlSafeField,
  isRecord,
} from "../validation/fields";
import { assertProfileData } from "../validation/profile";
import { assertSession } from "../validation/session";
import {
  CMAF_LLHLS_PROFILE_ID,
  MEDIA_TRACK_KINDS,
  type MediaCommittedSegment,
  type MediaCursor,
  type MediaObjectProfile,
  type MediaSession,
  type MediaSessionProfile,
  type MediaTrack,
  type MediaTrackProfile,
} from "./types";

export const MEDIA_SESSION_PROFILE_FIELDS = [
  "discontinuitySequence",
  "id",
  "partTarget",
  "segmentTarget",
] as const;

export const MEDIA_TRACK_PROFILE_FIELDS = [
  "bitrate",
  "channels",
  "codec",
  "defaultTrack",
  "frameRate",
  "groupId",
  "height",
  "kind",
  "name",
  "sampleRate",
  "width",
] as const;

export const MEDIA_OBJECT_PROFILE_FIELDS = [
  "discontinuityBefore",
  "duration",
  "independent",
  "programDateTime",
] as const;

const AUDIO_ONLY_TRACK_FIELDS = ["defaultTrack", "groupId", "name"] as const;

const OPTIONAL_TRACK_INTEGER_FIELDS = [
  "bitrate",
  "channels",
  "sampleRate",
] as const;

const TRACK_DIMENSION_FIELDS = ["width", "height"] as const;

// RFC 8216 §4.2: quoted-string attribute values (EXT-X-MEDIA NAME) have no
// escape mechanism, so these characters cannot be rendered.
const PLAYLIST_QUOTED_STRING_FORBIDDEN = /["\r\n]/;

/** Returns whether `value` is a valid `MediaSession`. */
export function isMediaSession(value: unknown): value is MediaSession {
  try {
    assertMediaSession(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a value as a Core `Session` running the CMAF/LL-HLS profile:
 * `assertSession` plus a well-formed session profile and a media track
 * profile on every track. Enforces the track invariants JSON Schema cannot
 * express: audio-group fields only on audio tracks, no mixing of grouped
 * and ungrouped audio, a single audio group per session, at most one
 * default track within it, and distinct effective names (`name ??
 * trackId`) within the group.
 */
export function assertMediaSession(
  value: unknown
): asserts value is MediaSession {
  assertSession(value);
  assertMediaSessionProfile(value.profile, "session.profile");

  for (const track of value.tracks) {
    assertMediaTrack(track);
  }

  assertAudioGroup(value.tracks as MediaTrack[]);
}

/** Validates a Core `Track` as carrying a media track profile. */
export function assertMediaTrack(value: Track): asserts value is MediaTrack {
  assertMediaTrackProfile(value.profile, `session.tracks[${value.trackId}]`);
}

/** Validates a Core `Cursor` as carrying the CMAF/LL-HLS session profile. */
export function assertMediaCursor(value: Cursor): asserts value is MediaCursor {
  assertMediaSessionProfile(value.profile, "cursor.profile");
}

/**
 * Validates `value` as a `MediaSessionProfile`: `id` must be `cmaf-llhls`,
 * `segmentTarget` and `partTarget` positive seconds, and
 * `discontinuitySequence` a non-negative integer when present.
 */
export function assertMediaSessionProfile(
  value: unknown,
  name: string
): asserts value is MediaSessionProfile {
  assertProfileData(value, name);
  assertOnlyKnownFields(value, MEDIA_SESSION_PROFILE_FIELDS, name);

  if (value.id !== CMAF_LLHLS_PROFILE_ID) {
    throw new Error(`${name}.id must be ${CMAF_LLHLS_PROFILE_ID}`);
  }

  assertPositiveNumberField(value, "segmentTarget", name);
  assertPositiveNumberField(value, "partTarget", name);

  if (value.discontinuitySequence !== undefined) {
    assertNonNegativeIntegerField(value, "discontinuitySequence", name);
  }
}

/**
 * Validates `value` as a `MediaTrackProfile`. Audio-group fields are only
 * allowed on audio tracks; `width` and `height` must be set together.
 */
export function assertMediaTrackProfile(
  value: unknown,
  name: string
): asserts value is MediaTrackProfile {
  if (value === undefined) {
    throw new Error(`${name}.profile is required`);
  }

  const profileName = `${name}.profile`;
  assertProfileData(value, profileName);
  assertOnlyKnownFields(value, MEDIA_TRACK_PROFILE_FIELDS, profileName);
  assertOneOfField(value, "kind", MEDIA_TRACK_KINDS, profileName);
  assertNonEmptyStringField(value, "codec", profileName);
  assertOptionalTrackMetrics(value, profileName);
  assertOptionalAudioGroupFields(value, profileName);
}

/**
 * Validates `value` as a `MediaObjectProfile`. When `requireDuration` is
 * set (segment and part objects), `duration` must be a positive number.
 */
export function assertMediaObjectProfile(
  value: unknown,
  name: string,
  options: { requireDuration?: boolean } = {}
): asserts value is MediaObjectProfile {
  assertProfileData(value, name);
  assertOnlyKnownFields(value, MEDIA_OBJECT_PROFILE_FIELDS, name);

  if (value.duration !== undefined || options.requireDuration) {
    assertPositiveNumberField(value, "duration", name);
  }

  if (value.independent !== undefined) {
    assertBooleanField(value, "independent", name);
  }

  if (value.discontinuityBefore !== undefined) {
    assertBooleanField(value, "discontinuityBefore", name);
  }

  if (value.programDateTime !== undefined) {
    assertIsoDateField(value, "programDateTime", name);
  }
}

/**
 * Returns the media profile data of a committed object, part, or slot, or
 * an empty profile when none is present.
 */
export function mediaObjectProfile(object: {
  profile?: ProfileData;
}): MediaObjectProfile {
  return (object.profile ?? {}) as MediaObjectProfile;
}

/**
 * Returns a committed segment's media duration in seconds: the full
 * segment's declared duration when present, otherwise the sum of its
 * visible parts. Throws when neither source carries a duration.
 */
export function mediaSegmentDuration(segment: CommittedSegment): number {
  const declared =
    segment.segment === undefined
      ? undefined
      : mediaObjectProfile(segment.segment).duration;

  if (declared !== undefined) {
    return declared;
  }

  const parts = segment.parts ?? [];

  if (parts.length === 0) {
    throw new Error("committed segment has no media duration");
  }

  return parts.reduce((total, part) => {
    const duration = mediaObjectProfile(part).duration;

    if (duration === undefined) {
      throw new Error("committed part has no media duration");
    }

    return total + duration;
  }, 0);
}

/**
 * Returns the wall-clock start of a committed segment: the segment
 * object's `programDateTime`, else part 0's. Undefined when neither is set.
 */
export function mediaSegmentProgramDateTime(
  segment: CommittedSegment
): string | undefined {
  const media = segment as MediaCommittedSegment;

  return (
    media.segment?.profile?.programDateTime ??
    media.parts?.[0]?.profile?.programDateTime
  );
}

/**
 * Returns whether a committed segment starts a new discontinuity: the
 * segment object's `discontinuityBefore`, else part 0's (for in-progress
 * segments that only have parts so far). False when neither is set.
 */
export function mediaSegmentDiscontinuityBefore(
  segment: CommittedSegment
): boolean {
  const media = segment as MediaCommittedSegment;

  return (
    (media.segment?.profile?.discontinuityBefore ??
      media.parts?.[0]?.profile?.discontinuityBefore) === true
  );
}

function assertAudioGroup(tracks: readonly MediaTrack[]): void {
  const audioTracks = tracks.filter((track) => track.profile.kind === "audio");
  const grouped = audioTracks.filter(
    (track) => track.profile.groupId !== undefined
  );

  if (grouped.length === 0) {
    return;
  }

  if (grouped.length !== audioTracks.length) {
    throw new Error(
      "session.tracks must not mix grouped and ungrouped audio tracks"
    );
  }

  if (new Set(grouped.map((track) => track.profile.groupId)).size > 1) {
    throw new Error("multiple audio groups are not supported");
  }

  const defaults = grouped.filter(
    (track) => track.profile.defaultTrack === true
  );

  if (defaults.length > 1) {
    throw new Error(
      "session.tracks must not flag multiple default audio tracks"
    );
  }

  assertDistinctAudioTrackNames(grouped);
}

// The effective EXT-X-MEDIA NAME is `name ?? trackId`; duplicates within
// a group are ambiguous to players (RFC 8216 §4.3.4.1.1). The full group
// is checked, so any availability-filtered subset stays distinct.
export function assertDistinctAudioTrackNames(
  grouped: readonly MediaTrack[]
): void {
  const names = new Set<string>();

  for (const track of grouped) {
    const name = track.profile.name ?? track.trackId;

    if (names.has(name)) {
      throw new Error(
        "session.tracks must have distinct audio track names within a group"
      );
    }

    names.add(name);
  }
}

function assertOptionalAudioGroupFields(
  value: Record<string, unknown>,
  name: string
): void {
  for (const field of AUDIO_ONLY_TRACK_FIELDS) {
    if (value[field] !== undefined && value.kind !== "audio") {
      throw new Error(`${name}.${field} is only allowed on audio tracks`);
    }
  }

  if (value.groupId !== undefined) {
    assertUrlSafeField(value, "groupId", name);
  }

  if (value.name !== undefined) {
    assertNonEmptyStringField(value, "name", name);

    if (PLAYLIST_QUOTED_STRING_FORBIDDEN.test(String(value.name))) {
      throw new Error(
        `${name}.name must not contain double quotes or line breaks`
      );
    }
  }

  if (value.defaultTrack !== undefined) {
    assertBooleanField(value, "defaultTrack", name);
  }
}

function assertOptionalTrackMetrics(
  value: Record<string, unknown>,
  name: string
): void {
  assertOptionalPositiveIntegerFields(
    value,
    OPTIONAL_TRACK_INTEGER_FIELDS,
    name
  );
  assertOptionalPositiveIntegerFields(value, TRACK_DIMENSION_FIELDS, name);
  assertTrackDimensions(value, name);

  if (value.frameRate !== undefined) {
    assertPositiveNumberField(value, "frameRate", name);
  }
}

function assertOptionalPositiveIntegerFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  name: string
): void {
  for (const field of fields) {
    if (value[field] !== undefined) {
      assertPositiveIntegerField(value, field, name);
    }
  }
}

function assertTrackDimensions(
  value: Record<string, unknown>,
  name: string
): void {
  const hasWidth = value.width !== undefined;
  const hasHeight = value.height !== undefined;

  if (hasWidth !== hasHeight) {
    throw new Error(`${name} must define width and height together`);
  }
}

/** Returns whether `value` looks like a record with a media profile. */
export function hasMediaProfile(value: unknown): value is { profile: unknown } {
  return isRecord(value) && value.profile !== undefined;
}
