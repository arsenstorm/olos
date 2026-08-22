import { OLOS_WIRE_VERSION } from "../index";
import type { Rendition, Session } from "../types/session";
import {
  LATENCY_PROFILES,
  RENDITION_KINDS,
  SESSION_STATES,
} from "../types/session";
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
  nonEmptyArray,
} from "./fields";

const SESSION_FIELDS = [
  "createdAt",
  "epoch",
  "latencyProfile",
  "olos",
  "partTarget",
  "renditions",
  "segmentTarget",
  "sessionId",
  "state",
] as const;

const RENDITION_FIELDS = [
  "bitrate",
  "channels",
  "codec",
  "defaultRendition",
  "frameRate",
  "groupId",
  "height",
  "kind",
  "name",
  "renditionId",
  "sampleRate",
  "width",
] as const;

const AUDIO_ONLY_RENDITION_FIELDS = [
  "defaultRendition",
  "groupId",
  "name",
] as const;

const OPTIONAL_RENDITION_INTEGER_FIELDS = [
  "bitrate",
  "channels",
  "sampleRate",
] as const;

const RENDITION_DIMENSION_FIELDS = ["width", "height"] as const;

// RFC 8216 §4.2: quoted-string attribute values (EXT-X-MEDIA NAME) have no
// escape mechanism, so these characters cannot be rendered.
const PLAYLIST_QUOTED_STRING_FORBIDDEN = /["\r\n]/;

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
 * rejects unknown fields, and enforces rendition invariants JSON Schema
 * cannot express: audio-group fields (`groupId`, `name`,
 * `defaultRendition`) only on audio renditions, no mixing of grouped and
 * ungrouped audio, a single audio group per session, at most one default
 * rendition within it, and distinct effective names (`name ??
 * renditionId`) within the group.
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
  assertOneOfField(value, "latencyProfile", LATENCY_PROFILES, "session");
  assertPositiveNumberField(value, "segmentTarget", "session");
  assertPositiveNumberField(value, "partTarget", "session");
  assertIsoDateField(value, "createdAt", "session");
  assertRenditions(value.renditions);
}

function assertRenditions(value: unknown): void {
  const renditions = nonEmptyArray<Rendition>(value, "session.renditions");

  const seenRenditions = new Set<string>();

  for (const rendition of renditions) {
    assertRendition(rendition);

    if (seenRenditions.has(rendition.renditionId)) {
      throw new Error("session.renditions must not contain duplicate IDs");
    }

    seenRenditions.add(rendition.renditionId);
  }

  assertAudioGroup(renditions);
}

function assertAudioGroup(renditions: readonly Rendition[]): void {
  const audioRenditions = renditions.filter(
    (rendition) => rendition.kind === "audio"
  );
  const grouped = audioRenditions.filter(
    (rendition) => rendition.groupId !== undefined
  );

  if (grouped.length === 0) {
    return;
  }

  if (grouped.length !== audioRenditions.length) {
    throw new Error(
      "session.renditions must not mix grouped and ungrouped audio renditions"
    );
  }

  if (new Set(grouped.map((rendition) => rendition.groupId)).size > 1) {
    throw new Error("multiple audio groups are not supported");
  }

  const defaults = grouped.filter(
    (rendition) => rendition.defaultRendition === true
  );

  if (defaults.length > 1) {
    throw new Error(
      "session.renditions must not flag multiple default audio renditions"
    );
  }

  assertDistinctAudioRenditionNames(grouped);
}

// The effective EXT-X-MEDIA NAME is `name ?? renditionId`; duplicates
// within a group are ambiguous to players (RFC 8216 §4.3.4.1.1). The full
// group is checked, so any availability-filtered subset stays distinct.
function assertDistinctAudioRenditionNames(
  grouped: readonly Rendition[]
): void {
  const names = new Set<string>();

  for (const rendition of grouped) {
    const name = rendition.name ?? rendition.renditionId;

    if (names.has(name)) {
      throw new Error(
        "session.renditions must have distinct audio rendition names within a group"
      );
    }

    names.add(name);
  }
}

function assertRendition(value: unknown): asserts value is Rendition {
  if (!isRecord(value)) {
    throw new Error("session.renditions[] must be an object");
  }

  assertOnlyKnownFields(value, RENDITION_FIELDS, "session.renditions[]");
  assertUrlSafeField(value, "renditionId", "session.renditions[]");
  assertOneOfField(value, "kind", RENDITION_KINDS, "session.renditions[]");
  assertNonEmptyStringField(value, "codec", "session.renditions[]");
  assertOptionalRenditionMetrics(value);
  assertOptionalAudioGroupFields(value);
}

function assertOptionalAudioGroupFields(value: Record<string, unknown>): void {
  for (const field of AUDIO_ONLY_RENDITION_FIELDS) {
    if (value[field] !== undefined && value.kind !== "audio") {
      throw new Error(
        `session.renditions[].${field} is only allowed on audio renditions`
      );
    }
  }

  if (value.groupId !== undefined) {
    assertUrlSafeField(value, "groupId", "session.renditions[]");
  }

  if (value.name !== undefined) {
    assertNonEmptyStringField(value, "name", "session.renditions[]");

    if (PLAYLIST_QUOTED_STRING_FORBIDDEN.test(String(value.name))) {
      throw new Error(
        "session.renditions[].name must not contain double quotes or line breaks"
      );
    }
  }

  if (value.defaultRendition !== undefined) {
    assertBooleanField(value, "defaultRendition", "session.renditions[]");
  }
}

function assertOptionalRenditionMetrics(value: Record<string, unknown>): void {
  assertOptionalPositiveIntegerFields(value, OPTIONAL_RENDITION_INTEGER_FIELDS);
  assertOptionalPositiveIntegerFields(value, RENDITION_DIMENSION_FIELDS);
  assertRenditionDimensions(value);

  if (value.frameRate !== undefined) {
    assertPositiveNumberField(value, "frameRate", "session.renditions[]");
  }
}

function assertOptionalPositiveIntegerFields(
  value: Record<string, unknown>,
  fields: readonly string[]
): void {
  for (const field of fields) {
    if (value[field] !== undefined) {
      assertPositiveIntegerField(value, field, "session.renditions[]");
    }
  }
}

function assertRenditionDimensions(value: Record<string, unknown>): void {
  if (hasPartialRenditionDimensions(value)) {
    throw new Error(
      "session.renditions[] must define width and height together"
    );
  }
}

function hasPartialRenditionDimensions(
  value: Record<string, unknown>
): boolean {
  return (
    (value.width === undefined && value.height !== undefined) ||
    (value.width !== undefined && value.height === undefined)
  );
}
