import { OLOS_WIRE_VERSION } from "../index";
import type { Session, Track } from "../types/session";
import { SESSION_STATES } from "../types/session";
import { assertContentType } from "./content-type";
import {
  assertIsoDateField,
  assertNonNegativeIntegerField,
  assertOneOfField,
  assertOnlyKnownFields,
  assertUrlSafeField,
  isRecord,
  nonEmptyArray,
} from "./fields";
import { assertOptionalProfileField, assertStreamProfile } from "./profile";

const SESSION_FIELDS = [
  "createdAt",
  "epoch",
  "olos",
  "profile",
  "sessionId",
  "state",
  "tracks",
] as const;

export const TRACK_FIELDS = ["contentType", "profile", "trackId"] as const;

/** Returns whether `value` is a valid `Session` (see `assertSession`). */
export function isSession(value: unknown): value is Session {
  try {
    assertSession(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates an untrusted value as a wire-format `Session`, throwing an
 * `Error` naming the first offending field. Checks the `olos` wire version,
 * rejects unknown fields, requires a `profile` with an `id`, and requires a
 * non-empty list of tracks with distinct IDs. Profile contents (session and
 * track) are not inspected; the profile module validates them.
 */
export function assertSession(value: unknown): asserts value is Session {
  if (!isRecord(value)) {
    throw new Error("session must be an object");
  }

  if (value.olos !== OLOS_WIRE_VERSION) {
    throw new Error(`session.olos must be ${OLOS_WIRE_VERSION}`);
  }

  assertOnlyKnownFields(value, SESSION_FIELDS, "session");
  assertUrlSafeField(value, "sessionId", "session");
  assertNonNegativeIntegerField(value, "epoch", "session");
  assertOneOfField(value, "state", SESSION_STATES, "session");
  assertIsoDateField(value, "createdAt", "session");
  assertStreamProfile(value.profile, "session.profile");
  assertTracks(value.tracks);
}

function assertTracks(value: unknown): void {
  const tracks = nonEmptyArray<Track>(value, "session.tracks");
  const seenTracks = new Set<string>();

  for (const track of tracks) {
    assertTrack(track);

    if (seenTracks.has(track.trackId)) {
      throw new Error("session.tracks must not contain duplicate IDs");
    }

    seenTracks.add(track.trackId);
  }
}

function assertTrack(value: unknown): asserts value is Track {
  if (!isRecord(value)) {
    throw new Error("session.tracks[] must be an object");
  }

  assertOnlyKnownFields(value, TRACK_FIELDS, "session.tracks[]");
  assertUrlSafeField(value, "trackId", "session.tracks[]");

  if (value.contentType !== undefined) {
    assertContentType(value.contentType, "session.tracks[].contentType");
  }

  assertOptionalProfileField(value, "session.tracks[]");
}
