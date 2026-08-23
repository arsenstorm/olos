import { describe, expect, test } from "bun:test";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import {
  OLOS_MEDIA_JSON_SCHEMAS,
  OLOS_MEDIA_OBJECT_PROFILE_SCHEMA,
  OLOS_MEDIA_SESSION_PROFILE_SCHEMA,
  OLOS_MEDIA_SESSION_SCHEMA,
  OLOS_MEDIA_TRACK_PROFILE_SCHEMA,
} from "./schema";
import {
  assertMediaObjectProfile,
  assertMediaSession,
  assertMediaSessionProfile,
  assertMediaTrackProfile,
} from "./validation";

const ajv = new Ajv({
  strictSchema: false,
  strictTypes: false,
  validateFormats: true,
});
addFormats(ajv);

const stripSchemaDraft = (
  schema: Record<string, unknown>
): Record<string, unknown> => {
  const normalized = { ...schema };
  normalized.$schema = undefined;
  return normalized;
};

interface Payload {
  label: string;
  payload: unknown;
}

interface DriftSuite {
  alsoValid?: readonly Payload[];
  assertValid: (value: unknown) => void;
  invalid: readonly Payload[];
  label: string;
  schema: Record<string, unknown>;
  valid: unknown;
  /** Sibling-track invariants JSON Schema cannot express. */
  validatorOnlyInvalid?: readonly Payload[];
}

const validVideoTrack = {
  profile: {
    bitrate: 4_500_000,
    codec: "avc1.640028",
    frameRate: 30,
    height: 1080,
    kind: "video",
    width: 1920,
  },
  trackId: "v1080",
} as const;

const validGroupedAudioTrack = {
  profile: {
    bitrate: 128_000,
    channels: 2,
    codec: "mp4a.40.2",
    defaultTrack: true,
    groupId: "aac",
    kind: "audio",
    name: "English",
    sampleRate: 48_000,
  },
  trackId: "a128",
} as const;

const validSessionProfile = {
  id: "cmaf-llhls",
  partTarget: 0.333,
  segmentTarget: 1,
} as const;

const validSession = {
  createdAt: "2026-06-08T12:00:00.000Z",
  epoch: 0,
  olos: "1.0",
  profile: validSessionProfile,
  sessionId: "session_1",
  state: "live",
  tracks: [validVideoTrack, validGroupedAudioTrack],
} as const;

const validObjectProfile = {
  duration: 0.5,
  independent: true,
  programDateTime: "2026-06-08T12:00:05.500Z",
} as const;

const suites: readonly DriftSuite[] = [
  {
    assertValid: assertMediaSession,
    invalid: [
      {
        label: "track without a profile",
        payload: { ...validSession, tracks: [{ trackId: "v1080" }] },
      },
      {
        label: "wrong profile id",
        payload: {
          ...validSession,
          profile: { ...validSessionProfile, id: "telemetry" },
        },
      },
      {
        label: "audio group ID on a video track",
        payload: {
          ...validSession,
          tracks: [
            {
              ...validVideoTrack,
              profile: { ...validVideoTrack.profile, groupId: "aac" },
            },
          ],
        },
      },
    ],
    label: "media session",
    schema: OLOS_MEDIA_SESSION_SCHEMA,
    valid: validSession,
    validatorOnlyInvalid: [
      {
        label: "multiple distinct audio groups",
        payload: {
          ...validSession,
          tracks: [
            validVideoTrack,
            validGroupedAudioTrack,
            {
              profile: {
                ...validGroupedAudioTrack.profile,
                defaultTrack: false,
                groupId: "aac-alt",
              },
              trackId: "a64",
            },
          ],
        },
      },
      {
        label: "multiple default audio tracks",
        payload: {
          ...validSession,
          tracks: [
            validVideoTrack,
            validGroupedAudioTrack,
            { ...validGroupedAudioTrack, trackId: "a64" },
          ],
        },
      },
      {
        label: "mixed grouped and ungrouped audio tracks",
        payload: {
          ...validSession,
          tracks: [
            validVideoTrack,
            validGroupedAudioTrack,
            { profile: { codec: "mp4a.40.2", kind: "audio" }, trackId: "a64" },
          ],
        },
      },
    ],
  },
  {
    alsoValid: [
      {
        label: "discontinuity sequence baseline",
        payload: { ...validSessionProfile, discontinuitySequence: 3 },
      },
    ],
    assertValid: (value) => assertMediaSessionProfile(value, "profile"),
    invalid: [
      {
        label: "zero segment target",
        payload: { ...validSessionProfile, segmentTarget: 0 },
      },
      {
        label: "missing part target",
        payload: { id: "cmaf-llhls", segmentTarget: 1 },
      },
      {
        label: "negative discontinuity sequence",
        payload: { ...validSessionProfile, discontinuitySequence: -1 },
      },
      {
        label: "unknown extra field",
        payload: { ...validSessionProfile, extra: 1 },
      },
    ],
    label: "media session profile",
    schema: OLOS_MEDIA_SESSION_PROFILE_SCHEMA,
    valid: validSessionProfile,
  },
  {
    alsoValid: [
      { label: "video track", payload: validVideoTrack.profile },
      {
        label: "text track without metrics",
        payload: { codec: "wvtt", kind: "text" },
      },
    ],
    assertValid: (value) => assertMediaTrackProfile(value, "track"),
    invalid: [
      {
        label: "unknown track kind",
        payload: { ...validVideoTrack.profile, kind: "image" },
      },
      {
        label: "empty codec",
        payload: { ...validVideoTrack.profile, codec: "" },
      },
      {
        label: "width without height",
        payload: { codec: "avc1.640028", kind: "video", width: 1920 },
      },
      {
        label: "zero bitrate",
        payload: { ...validVideoTrack.profile, bitrate: 0 },
      },
      {
        label: "default track flag on a video track",
        payload: { ...validVideoTrack.profile, defaultTrack: true },
      },
      {
        label: "unsafe group ID",
        payload: { ...validGroupedAudioTrack.profile, groupId: "not a group" },
      },
    ],
    label: "media track profile",
    schema: OLOS_MEDIA_TRACK_PROFILE_SCHEMA,
    valid: validGroupedAudioTrack.profile,
    validatorOnlyInvalid: [
      {
        label: "name with a double quote",
        payload: { ...validGroupedAudioTrack.profile, name: 'English "TV"' },
      },
    ],
  },
  {
    alsoValid: [
      { label: "empty profile", payload: {} },
      {
        label: "discontinuity marker",
        payload: { discontinuityBefore: true, duration: 2 },
      },
    ],
    assertValid: (value) => assertMediaObjectProfile(value, "profile"),
    invalid: [
      {
        label: "zero duration",
        payload: { ...validObjectProfile, duration: 0 },
      },
      {
        label: "non-boolean independent flag",
        payload: { ...validObjectProfile, independent: "yes" },
      },
      {
        label: "invalid program date-time",
        payload: { ...validObjectProfile, programDateTime: "soon" },
      },
      {
        label: "unknown extra field",
        payload: { ...validObjectProfile, extra: 1 },
      },
    ],
    label: "media object profile",
    schema: OLOS_MEDIA_OBJECT_PROFILE_SCHEMA,
    valid: validObjectProfile,
  },
];

test("covers every exported OLOS media JSON schema", () => {
  const coveredSchemas = new Set(suites.map((suite) => suite.schema));

  expect(coveredSchemas.size).toBe(Object.keys(OLOS_MEDIA_JSON_SCHEMAS).length);

  for (const schema of Object.values(OLOS_MEDIA_JSON_SCHEMAS)) {
    expect(coveredSchemas.has(schema)).toBe(true);
  }
});

for (const suite of suites) {
  const validateSchema = ajv.compile(stripSchemaDraft(suite.schema));

  describe(`${suite.label} schema-vs-runtime drift`, () => {
    test("accepts a canonical valid payload", () => {
      expect(validateSchema(suite.valid)).toBe(true);
      expect(() => suite.assertValid(suite.valid)).not.toThrow();
    });

    for (const valid of suite.alsoValid ?? []) {
      test(`accepts valid payload: ${valid.label}`, () => {
        expect(validateSchema(valid.payload)).toBe(true);
        expect(() => suite.assertValid(valid.payload)).not.toThrow();
      });
    }

    for (const invalid of suite.invalid) {
      test(`rejects canonical invalid payload: ${invalid.label}`, () => {
        expect(validateSchema(invalid.payload)).toBe(false);
        expect(() => suite.assertValid(invalid.payload)).toThrow();
      });
    }

    for (const invalid of suite.validatorOnlyInvalid ?? []) {
      test(`rejects validator-only invalid payload: ${invalid.label}`, () => {
        expect(validateSchema(invalid.payload)).toBe(true);
        expect(() => suite.assertValid(invalid.payload)).toThrow();
      });
    }
  });
}
