import { describe, expect, test } from "bun:test";
import { Ajv } from "ajv";
import {
  OLOS_COMMIT_SCHEMA,
  OLOS_COMMITTED_WINDOW_SCHEMA,
  OLOS_CURSOR_SCHEMA,
  OLOS_SESSION_SCHEMA,
  OLOS_UPLOAD_SLOT_SCHEMA,
} from "./schema";
import { assertCommit } from "./validation/commit";
import { assertCommittedWindow } from "./validation/committed-window";
import { assertCursor } from "./validation/cursor";
import { assertSession } from "./validation/session";
import { assertUploadSlot } from "./validation/upload-slot";

const ajv = new Ajv({ strictSchema: false, validateFormats: false });
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
}

const validSession = {
  createdAt: "2026-06-08T12:00:00.000Z",
  epoch: 0,
  latencyProfile: "object-ll",
  olos: "1.0",
  partTarget: 0.333,
  renditions: [
    {
      bitrate: 4_500_000,
      codec: "avc1.640028",
      frameRate: 30,
      height: 1080,
      kind: "video",
      renditionId: "v1080",
      width: 1920,
    },
  ],
  segmentTarget: 1,
  sessionId: "session_1",
  state: "live",
  tenantId: "tenant_1",
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
  providerId: "r2-primary",
  publicationMode: "direct-public",
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
  publicationMode: "direct-public",
  publisherInstanceId: "pubinst_01",
  renditionId: "v1080",
  sessionId: "sess_01JZLIVE",
  slotId: "slot_01JZ",
  state: "issued",
  tenantId: "tenant_acme",
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
  partTarget: 0.333,
  pathways: [
    {
      baseUrl: "https://media.example.com",
      pathwayId: "primary",
      priority: 0,
      providerId: "provider_1",
      state: "active",
    },
  ],
  segmentTarget: 1,
  sessionId: "session_1",
  state: "live",
  tenantId: "tenant_1",
  updatedAt: "2026-06-08T12:00:01.820Z",
  window: {
    firstMediaSequenceNumber: 3810,
    lastMediaSequenceNumber: 3812,
  },
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
  },
];

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
  });
}
