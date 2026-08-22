// biome-ignore lint/style/noRestrictedImports: OLOS_SESSION_SCHEMA is defined in schema.ts itself, not re-exported
import { OLOS_SESSION_SCHEMA } from "../schema";
import {
  id,
  JSON_SCHEMA_DRAFT,
  nonEmptyString,
  nonNegativeInteger,
  type OlosJsonSchema,
  positiveNumber,
  stringEnum,
  timestamp,
} from "../schema-fragments";
import { CMAF_LLHLS_PROFILE_ID, MEDIA_TRACK_KINDS } from "./types";

const JSON_SCHEMA_THEN = "then";

/** JSON Schema (2020-12) for `MediaSessionProfile` (`session.profile`). */
export const OLOS_MEDIA_SESSION_PROFILE_SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT,
  additionalProperties: false,
  properties: {
    discontinuitySequence: nonNegativeInteger,
    id: { const: CMAF_LLHLS_PROFILE_ID },
    partTarget: positiveNumber,
    segmentTarget: positiveNumber,
  },
  required: ["id", "partTarget", "segmentTarget"],
  title: "OLOS Media Session Profile",
  type: "object",
} as const satisfies OlosJsonSchema;

// groupId/name/defaultTrack describe HLS audio group membership, so they
// are only meaningful on audio tracks. `false` property subschemas reject
// the fields whenever the track kind is not "audio". The single-group and
// single-default constraints span sibling tracks, which JSON Schema
// 2020-12 cannot express; only the runtime validator (assertMediaSession)
// enforces them.
const trackAudioGroupFieldsPrecondition = {
  if: {
    not: {
      properties: {
        kind: { const: "audio" },
      },
      required: ["kind"],
    },
  },
  [JSON_SCHEMA_THEN]: {
    properties: {
      defaultTrack: false,
      groupId: false,
      name: false,
    },
  },
} as const;

/** JSON Schema (2020-12) for `MediaTrackProfile` (`tracks[].profile`). */
export const OLOS_MEDIA_TRACK_PROFILE_SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT,
  additionalProperties: false,
  allOf: [trackAudioGroupFieldsPrecondition],
  dependentRequired: {
    height: ["width"],
    width: ["height"],
  },
  properties: {
    bitrate: { exclusiveMinimum: 0, type: "integer" },
    channels: { exclusiveMinimum: 0, type: "integer" },
    codec: nonEmptyString,
    defaultTrack: { type: "boolean" },
    frameRate: positiveNumber,
    groupId: id,
    height: { exclusiveMinimum: 0, type: "integer" },
    kind: stringEnum(MEDIA_TRACK_KINDS),
    name: nonEmptyString,
    sampleRate: { exclusiveMinimum: 0, type: "integer" },
    width: { exclusiveMinimum: 0, type: "integer" },
  },
  required: ["codec", "kind"],
  title: "OLOS Media Track Profile",
  type: "object",
} as const satisfies OlosJsonSchema;

/**
 * JSON Schema (2020-12) for `MediaObjectProfile` — the `profile` of slots,
 * commits, and committed objects under the CMAF/LL-HLS profile.
 */
export const OLOS_MEDIA_OBJECT_PROFILE_SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT,
  additionalProperties: false,
  properties: {
    discontinuityBefore: { type: "boolean" },
    duration: positiveNumber,
    independent: { type: "boolean" },
    programDateTime: timestamp,
  },
  title: "OLOS Media Object Profile",
  type: "object",
} as const satisfies OlosJsonSchema;

/**
 * JSON Schema (2020-12) for a `Session` running the CMAF/LL-HLS profile:
 * the Core session schema with the session and track profiles pinned to
 * their media schemas. Sibling-track audio-group invariants are only
 * enforced by `assertMediaSession`.
 */
export const OLOS_MEDIA_SESSION_SCHEMA = {
  ...OLOS_SESSION_SCHEMA,
  properties: {
    ...OLOS_SESSION_SCHEMA.properties,
    profile: OLOS_MEDIA_SESSION_PROFILE_SCHEMA,
    tracks: {
      items: {
        ...OLOS_SESSION_SCHEMA.properties.tracks.items,
        properties: {
          ...OLOS_SESSION_SCHEMA.properties.tracks.items.properties,
          profile: OLOS_MEDIA_TRACK_PROFILE_SCHEMA,
        },
        required: ["profile", "trackId"],
      },
      minItems: 1,
      type: "array",
    },
  },
  title: "OLOS Media Session",
} as const satisfies OlosJsonSchema;

/** All CMAF/LL-HLS profile schemas keyed by document name. */
export const OLOS_MEDIA_JSON_SCHEMAS = {
  mediaObjectProfile: OLOS_MEDIA_OBJECT_PROFILE_SCHEMA,
  mediaSession: OLOS_MEDIA_SESSION_SCHEMA,
  mediaSessionProfile: OLOS_MEDIA_SESSION_PROFILE_SCHEMA,
  mediaTrackProfile: OLOS_MEDIA_TRACK_PROFILE_SCHEMA,
} as const;
