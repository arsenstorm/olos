import { describe, expect, test } from "bun:test";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import {
  OLOS_COMMIT_SCHEMA,
  OLOS_COMMITTED_WINDOW_SCHEMA,
  OLOS_CURSOR_SCHEMA,
  OLOS_ERROR_SCHEMA,
  OLOS_JSON_SCHEMAS,
  OLOS_MEDIA_OBJECT_SCHEMA,
  OLOS_PROVIDER_CAPABILITY_SCHEMA,
  OLOS_SESSION_SCHEMA,
  OLOS_UPLOAD_GRANT_SCHEMA,
  OLOS_UPLOAD_SLOT_SCHEMA,
} from "./schema";
import { createOlosError } from "./types/errors";
import { assertCommit } from "./validation/commit";
import { assertCommittedWindow } from "./validation/committed-window";
import { assertCursor } from "./validation/cursor";
import { assertOlosErrorEnvelope } from "./validation/error-envelope";
import { assertMediaObject } from "./validation/media-object";
import { assertProviderCapabilityDocument } from "./validation/provider-capability";
import { assertSession } from "./validation/session";
import { assertUploadGrant } from "./validation/upload-grant";
import { assertUploadSlot } from "./validation/upload-slot";

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

interface InvalidPayload {
  label: string;
  payload: unknown;
}

interface DriftSuite {
  assertValid: (value: unknown) => void;
  invalid: readonly InvalidPayload[];
  label: string;
  schema: Record<string, unknown>;
  valid: unknown;
  /**
   * Payloads the runtime validator must reject even though the JSON schema
   * accepts them. JSON Schema 2020-12 cannot express relations between
   * sibling fields (e.g. uploadSlot minBytes <= maxBytes), so these
   * constraints only exist on the validator side.
   */
  validatorOnlyInvalid?: readonly InvalidPayload[];
}

const validVideoRendition = {
  bitrate: 4_500_000,
  codec: "avc1.640028",
  frameRate: 30,
  height: 1080,
  kind: "video",
  renditionId: "v1080",
  width: 1920,
} as const;

const validGroupedAudioRendition = {
  bitrate: 128_000,
  channels: 2,
  codec: "mp4a.40.2",
  defaultRendition: true,
  groupId: "aac",
  kind: "audio",
  name: "English",
  renditionId: "a128",
  sampleRate: 48_000,
} as const;

const validSession = {
  createdAt: "2026-06-08T12:00:00.000Z",
  epoch: 0,
  latencyProfile: "object-ll",
  olos: "1.0",
  partTarget: 0.333,
  renditions: [validVideoRendition, validGroupedAudioRendition],
  segmentTarget: 1,
  sessionId: "session_1",
  state: "live",
} as const;

const validCommit = {
  commitId: "commit_01JZ",
  committedAt: "2026-06-08T12:00:01.820Z",
  deliveryUrl:
    "https://media.example.com/media/tenant/sess/e1/v1080/s3812/p3.m4s",
  duration: 0.5,
  epoch: 1,
  etag: '"9b2cf535f27731c974343645a3985328"',
  independent: false,
  mediaSequenceNumber: 3812,
  objectKey: "media/tenant/sess/e1/v1080/s3812/p3.m4s",
  partNumber: 3,
  programDateTime: "2026-06-08T12:00:05.500Z",
  renditionId: "v1080",
  sessionId: "sess_01JZLIVE",
  size: 312_500,
  slotId: "slot_01JZ",
} as const;

const validUploadSlot = {
  contentType: "video/mp4",
  deliveryUrl:
    "https://media.example.com/media/tenant/sess/e1/v1080/s3812/p3.m4s",
  duration: 0.5,
  epoch: 1,
  expiresAt: "2026-06-08T12:00:05Z",
  kind: "part",
  maxBytes: 524_288,
  mediaSequenceNumber: 3812,
  minBytes: 1024,
  objectKey: "media/tenant/sess/e1/v1080/s3812/p3.m4s",
  partNumber: 3,
  renditionId: "v1080",
  sessionId: "sess_01JZLIVE",
  slotId: "slot_01JZ",
  state: "issued",
} as const;

const validCommittedWindow = {
  discontinuitySequence: 0,
  epoch: 1,
  firstMediaSequenceNumber: 3810,
  lastMediaSequenceNumber: 3812,
  renditions: {
    v1080: {
      init: {
        commitId: "commit_init",
        deliveryUrl:
          "https://media.example.com/media/tenant/sess/e1/v1080/init.mp4",
        objectKey: "media/tenant/sess/e1/v1080/init.mp4",
        slotId: "slot_init",
      },
      renditionId: "v1080",
      segments: [
        {
          duration: 2,
          mediaSequenceNumber: 3810,
          segment: {
            commitId: "commit_3810",
            deliveryUrl:
              "https://media.example.com/media/tenant/sess/e1/v1080/s3810.m4s",
            objectKey: "media/tenant/sess/e1/v1080/s3810.m4s",
            slotId: "slot_3810",
          },
        },
        {
          duration: 2,
          mediaSequenceNumber: 3811,
          segment: {
            commitId: "commit_3811",
            deliveryUrl:
              "https://media.example.com/media/tenant/sess/e1/v1080/s3811.m4s",
            objectKey: "media/tenant/sess/e1/v1080/s3811.m4s",
            slotId: "slot_3811",
          },
        },
        {
          duration: 2,
          mediaSequenceNumber: 3812,
          parts: [
            {
              commitId: "commit_3812_0",
              deliveryUrl:
                "https://media.example.com/media/tenant/sess/e1/v1080/s3812/p0.m4s",
              duration: 0.5,
              independent: true,
              objectKey: "media/tenant/sess/e1/v1080/s3812/p0.m4s",
              partNumber: 0,
              slotId: "slot_3812_0",
            },
            {
              commitId: "commit_3812_1",
              deliveryUrl:
                "https://media.example.com/media/tenant/sess/e1/v1080/s3812/p1.m4s",
              duration: 0.5,
              objectKey: "media/tenant/sess/e1/v1080/s3812/p1.m4s",
              partNumber: 1,
              slotId: "slot_3812_1",
            },
          ],
        },
      ],
    },
  },
} as const;

const validCursor = {
  committedWindow: validCommittedWindow,
  epoch: 1,
  latencyProfile: "object-ll",
  olos: "1.0",
  mediaBaseUrl: "https://media.example.com",
  partTarget: 0.333,
  segmentTarget: 1,
  sessionId: "session_1",
  state: "live",
  updatedAt: "2026-06-08T12:00:01.820Z",
  window: {
    firstMediaSequenceNumber: 3810,
    lastMediaSequenceNumber: 3812,
  },
} as const;

const validOlosError = createOlosError(
  "olos.invalid_request",
  "sessionId must be present",
  { field: "sessionId" }
);

const validMediaObject = {
  contentType: "video/mp4",
  etag: '"9b2cf535f27731c974343645a3985328"',
  objectKey: "media/tenant/sess/e1/v1080/s3810.m4s",
  observedAt: "2026-06-08T12:00:01.820Z",
  providerId: "r2_primary",
  size: 98_304,
} as const;

const validProviderCapability = {
  api: {
    family: "s3-compatible",
  },
  consistency: {
    headAfterCreate: "strong",
    listAfterCreate: "strong",
    readAfterCreate: "strong",
  },
  delivery: {
    documentNavigationCanBeBlocked: true,
    immutableCaching: true,
    negativeCachingPolicyDeclared: true,
    publicBaseUrl: "https://media.example.com",
    rangeRequests: true,
  },
  events: {
    delivery: "at-least-once",
    objectCreated: true,
  },
  kind: "object-store",
  olos: "1.0",
  providerId: "r2_primary",
  publication: {
    createIfAbsent: true,
    directObjectPublication: true,
    manifestGatedPublication: true,
    overwritesAllowed: false,
    privateUploadPublicPromotion: true,
    readGateAvailable: true,
  },
  uploadGrants: {
    contentTypeBound: true,
    exactKey: true,
    maxRecommendedTtlSeconds: 60,
    methodBound: true,
    objectSizeCanBeObserved: true,
    presignedPut: true,
    requiredHeadersCanBeSigned: true,
    temporaryCredentials: true,
  },
} as const;

const validUploadGrant = {
  expiresAt: "2026-06-08T12:00:05.000Z",
  method: "PUT",
  requiredHeaders: {
    "content-type": "video/iso.segment",
    "x-upload-token": "token_1",
  },
  slotId: "slot_01JZ",
  url: "https://upload.example.com/session/slot_01JZ",
} as const;

const suites: readonly DriftSuite[] = [
  {
    label: "session",
    schema: OLOS_SESSION_SCHEMA,
    valid: validSession,
    assertValid: assertSession,
    invalid: [
      {
        label: "invalid rendition list",
        payload: { ...validSession, renditions: [] },
      },
      {
        label: "unsupported session state",
        payload: { ...validSession, state: "paused" },
      },
      {
        label: "invalid epoch",
        payload: { ...validSession, epoch: -1 },
      },
      {
        label: "date-only createdAt timestamp",
        payload: { ...validSession, createdAt: "2026-06-08" },
      },
      {
        label: "impossible createdAt calendar date",
        payload: { ...validSession, createdAt: "2026-02-30T12:00:00.000Z" },
      },
      {
        label: "audio group ID on a video rendition",
        payload: {
          ...validSession,
          renditions: [{ ...validVideoRendition, groupId: "aac" }],
        },
      },
    ],
    validatorOnlyInvalid: [
      {
        label: "multiple distinct audio groups",
        payload: {
          ...validSession,
          renditions: [
            validVideoRendition,
            validGroupedAudioRendition,
            {
              ...validGroupedAudioRendition,
              defaultRendition: false,
              groupId: "aac-alt",
              renditionId: "a64",
            },
          ],
        },
      },
      {
        label: "multiple default audio renditions",
        payload: {
          ...validSession,
          renditions: [
            validVideoRendition,
            validGroupedAudioRendition,
            { ...validGroupedAudioRendition, renditionId: "a64" },
          ],
        },
      },
      {
        label: "mixed grouped and ungrouped audio renditions",
        payload: {
          ...validSession,
          renditions: [
            validVideoRendition,
            validGroupedAudioRendition,
            {
              codec: "mp4a.40.2",
              kind: "audio",
              renditionId: "a64",
            },
          ],
        },
      },
    ],
  },
  {
    label: "commit",
    schema: OLOS_COMMIT_SCHEMA,
    valid: validCommit,
    assertValid: assertCommit,
    invalid: [
      {
        label: "invalid size",
        payload: { ...validCommit, size: 0 },
      },
      {
        label: "fractional size",
        payload: { ...validCommit, size: 312.5 },
      },
      {
        label: "invalid media sequence",
        payload: { ...validCommit, mediaSequenceNumber: -1 },
      },
      {
        label: "invalid delivery URL",
        payload: {
          ...validCommit,
          deliveryUrl: "https://media.example.com/key.m4s?token=abc",
        },
      },
      {
        label: "hour-24 committedAt timestamp",
        payload: { ...validCommit, committedAt: "2026-06-08T24:00:00.000Z" },
      },
    ],
    validatorOnlyInvalid: [
      {
        label: "unsafe integer size",
        payload: { ...validCommit, size: 2 ** 53 + 2 },
      },
    ],
  },
  {
    label: "upload slot",
    schema: OLOS_UPLOAD_SLOT_SCHEMA,
    valid: validUploadSlot,
    assertValid: assertUploadSlot,
    invalid: [
      {
        label: "invalid duration",
        payload: { ...validUploadSlot, duration: 0 },
      },
      {
        label: "unsafe object key",
        payload: { ...validUploadSlot, objectKey: "media/../secret.m4s" },
      },
      {
        label: "fractional maxBytes",
        payload: { ...validUploadSlot, maxBytes: 1024.5 },
      },
      {
        label: "leap-second expiresAt timestamp",
        payload: { ...validUploadSlot, expiresAt: "2026-06-08T12:00:60Z" },
      },
    ],
    validatorOnlyInvalid: [
      {
        label: "minBytes greater than maxBytes",
        payload: { ...validUploadSlot, maxBytes: 1024, minBytes: 2048 },
      },
      {
        label: "unsafe integer maxBytes",
        payload: { ...validUploadSlot, maxBytes: 2 ** 53 + 2 },
      },
    ],
  },
  {
    label: "committed window",
    schema: OLOS_COMMITTED_WINDOW_SCHEMA,
    valid: validCommittedWindow,
    assertValid: assertCommittedWindow,
    invalid: [
      {
        label: "invalid epoch",
        payload: { ...validCommittedWindow, epoch: -1 },
      },
      {
        label: "missing renditions",
        payload: {
          discontinuitySequence: 0,
          firstMediaSequenceNumber: 3810,
          lastMediaSequenceNumber: 3812,
        } as const,
      },
      {
        label: "invalid object key",
        payload: {
          ...validCommittedWindow,
          renditions: {
            v1080: {
              ...validCommittedWindow.renditions.v1080,
              init: {
                ...validCommittedWindow.renditions.v1080.init,
                objectKey: "media/../secret.m4s",
              },
            },
          },
        },
      },
      {
        label: "unknown extra field",
        payload: { ...validCommittedWindow, extra: 1 },
      },
      {
        label: "unknown extra field on a committed part",
        payload: {
          ...validCommittedWindow,
          renditions: {
            v1080: {
              ...validCommittedWindow.renditions.v1080,
              segments: [
                ...validCommittedWindow.renditions.v1080.segments.slice(0, 2),
                {
                  ...validCommittedWindow.renditions.v1080.segments[2],
                  parts: [
                    {
                      ...validCommittedWindow.renditions.v1080.segments[2]
                        ?.parts?.[0],
                      extra: 1,
                    },
                    validCommittedWindow.renditions.v1080.segments[2]
                      ?.parts?.[1],
                  ],
                },
              ],
            },
          },
        },
      },
    ],
  },
  {
    label: "cursor",
    schema: OLOS_CURSOR_SCHEMA,
    valid: validCursor,
    assertValid: assertCursor,
    invalid: [
      {
        label: "invalid state",
        payload: { ...validCursor, state: "paused" },
      },
      {
        label: "invalid epoch",
        payload: { ...validCursor, epoch: -1 },
      },
      {
        label: "invalid window part number type",
        payload: {
          ...validCursor,
          window: {
            ...validCursor.window,
            lastPartNumber: "wrong",
          },
        },
      },
    ],
    validatorOnlyInvalid: [
      {
        label: "window lastPartNumber not matching the committed window",
        payload: {
          ...validCursor,
          window: {
            ...validCursor.window,
            lastPartNumber: 5,
          },
        },
      },
    ],
  },
  {
    label: "error",
    schema: OLOS_ERROR_SCHEMA,
    valid: validOlosError,
    assertValid: assertOlosErrorEnvelope,
    invalid: [
      {
        label: "missing error code",
        payload: { error: { message: "sessionId must be present" } },
      },
      {
        label: "unknown error code",
        payload: {
          error: { code: "olos.unknown_code", message: "unmapped failure" },
        },
      },
      {
        label: "empty message",
        payload: createOlosError("olos.not_found", ""),
      },
    ],
  },
  {
    label: "media object",
    schema: OLOS_MEDIA_OBJECT_SCHEMA,
    valid: validMediaObject,
    assertValid: assertMediaObject,
    invalid: [
      {
        label: "fractional size",
        payload: { ...validMediaObject, size: 98_304.5 },
      },
      {
        label: "unsafe object key",
        payload: { ...validMediaObject, objectKey: "media/../secret.m4s" },
      },
      {
        label: "date-only observedAt timestamp",
        payload: { ...validMediaObject, observedAt: "2026-06-08" },
      },
      {
        label: "space-separated observedAt timestamp",
        payload: { ...validMediaObject, observedAt: "2026-06-08 12:00:00Z" },
      },
      {
        label: "unknown extra field",
        payload: { ...validMediaObject, extra: 1 },
      },
    ],
  },
  {
    label: "provider capability",
    schema: OLOS_PROVIDER_CAPABILITY_SCHEMA,
    valid: validProviderCapability,
    assertValid: assertProviderCapabilityDocument,
    invalid: [
      {
        label: "unsupported provider kind",
        payload: { ...validProviderCapability, kind: "database" },
      },
      {
        label: "upload grants without a mechanism",
        payload: {
          ...validProviderCapability,
          uploadGrants: {
            contentTypeBound: true,
            exactKey: true,
            methodBound: true,
            objectSizeCanBeObserved: true,
            requiredHeadersCanBeSigned: true,
          },
        },
      },
      {
        label: "direct object publication without strong head-after-create",
        payload: {
          ...validProviderCapability,
          consistency: {
            ...validProviderCapability.consistency,
            headAfterCreate: "eventual",
          },
        },
      },
      {
        label: "unknown extra field",
        payload: { ...validProviderCapability, extra: 1 },
      },
      {
        label: "unknown extra field on uploadGrants",
        payload: {
          ...validProviderCapability,
          uploadGrants: { ...validProviderCapability.uploadGrants, extra: 1 },
        },
      },
    ],
  },
  {
    label: "upload grant",
    schema: OLOS_UPLOAD_GRANT_SCHEMA,
    valid: validUploadGrant,
    assertValid: assertUploadGrant,
    invalid: [
      {
        label: "date-only expiresAt timestamp",
        payload: { ...validUploadGrant, expiresAt: "2026-06-08" },
      },
      {
        label: "unsupported method",
        payload: { ...validUploadGrant, method: "POST" },
      },
      {
        label: "invalid upload URL",
        payload: { ...validUploadGrant, url: "not a url" },
      },
      {
        label: "no-colon offset expiresAt timestamp",
        payload: { ...validUploadGrant, expiresAt: "2026-06-08T12:00:05+0100" },
      },
      {
        label: "unknown extra field",
        payload: { ...validUploadGrant, extra: 1 },
      },
    ],
  },
];

test("covers every exported OLOS JSON schema", () => {
  const coveredSchemas = new Set(suites.map((suite) => suite.schema));

  expect(coveredSchemas.size).toBe(Object.keys(OLOS_JSON_SCHEMAS).length);

  for (const schema of Object.values(OLOS_JSON_SCHEMAS)) {
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

    for (const invalid of suite.invalid) {
      test(`rejects canonical invalid payload: ${invalid.label}`, () => {
        expect(validateSchema(invalid.payload)).toBe(false);
        expect(() => suite.assertValid(invalid.payload)).toThrow();
      });
    }

    for (const invalid of suite.validatorOnlyInvalid ?? []) {
      test(`rejects validator-only invalid payload: ${invalid.label}`, () => {
        // The schema cannot express this constraint, so it accepts the
        // payload; only the runtime validator rejects it.
        expect(validateSchema(invalid.payload)).toBe(true);
        expect(() => suite.assertValid(invalid.payload)).toThrow();
      });
    }
  });
}
