import { MEDIA_OBJECT_KINDS } from "./config/media-object";
import { PATHWAY_STATES } from "./config/pathway";
import { PUBLICATION_MODES } from "./config/publication";
import {
  LATENCY_PROFILES,
  RENDITION_KINDS,
  SESSION_STATES,
} from "./config/session";
import { UPLOAD_SLOT_STATES } from "./config/upload-slot";

export interface OlosJsonSchema {
  readonly [key: string]: unknown;
}

const JSON_SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema";
const ID_PATTERN = "^[A-Za-z0-9_-]+$";
const SAFE_OBJECT_KEY_PATTERN =
  "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).+[^/]$";

const id = { minLength: 1, pattern: ID_PATTERN, type: "string" } as const;
const nonEmptyString = { minLength: 1, type: "string" } as const;
const nonNegativeInteger = { minimum: 0, type: "integer" } as const;
const positiveNumber = { exclusiveMinimum: 0, type: "number" } as const;
const timestamp = { format: "date-time", type: "string" } as const;
const objectKey = {
  minLength: 1,
  pattern: SAFE_OBJECT_KEY_PATTERN,
  type: "string",
} as const;

const committedObjectSchema = {
  additionalProperties: false,
  properties: {
    commitId: id,
    contentType: nonEmptyString,
    deliveryUrl: nonEmptyString,
    duration: positiveNumber,
    etag: nonEmptyString,
    objectKey,
    slotId: id,
  },
  required: ["commitId", "deliveryUrl", "objectKey", "slotId"],
  type: "object",
} as const;

const committedPartSchema = {
  additionalProperties: false,
  properties: {
    ...committedObjectSchema.properties,
    duration: positiveNumber,
    independent: { type: "boolean" },
    partNumber: nonNegativeInteger,
    programDateTime: timestamp,
  },
  required: [...committedObjectSchema.required, "duration", "partNumber"],
  type: "object",
} as const;

const committedSegmentSchema = {
  additionalProperties: false,
  properties: {
    discontinuityBefore: { type: "boolean" },
    duration: positiveNumber,
    independent: { type: "boolean" },
    mediaSequenceNumber: nonNegativeInteger,
    parts: { items: committedPartSchema, type: "array" },
    programDateTime: timestamp,
    segment: committedObjectSchema,
  },
  required: ["duration", "mediaSequenceNumber"],
  type: "object",
} as const;

const renditionWindowSchema = {
  additionalProperties: false,
  properties: {
    init: committedObjectSchema,
    renditionId: id,
    segments: { items: committedSegmentSchema, type: "array" },
  },
  required: ["init", "renditionId", "segments"],
  type: "object",
} as const;

export const OLOS_SESSION_SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT,
  additionalProperties: false,
  properties: {
    createdAt: timestamp,
    epoch: nonNegativeInteger,
    latencyProfile: { enum: LATENCY_PROFILES, type: "string" },
    olos: { const: "1.0" },
    partTarget: positiveNumber,
    renditions: {
      items: {
        additionalProperties: false,
        properties: {
          bitrate: { exclusiveMinimum: 0, type: "integer" },
          channels: { exclusiveMinimum: 0, type: "integer" },
          codec: nonEmptyString,
          frameRate: positiveNumber,
          height: { exclusiveMinimum: 0, type: "integer" },
          kind: { enum: RENDITION_KINDS, type: "string" },
          renditionId: id,
          sampleRate: { exclusiveMinimum: 0, type: "integer" },
          width: { exclusiveMinimum: 0, type: "integer" },
        },
        required: ["codec", "kind", "renditionId"],
        type: "object",
      },
      minItems: 1,
      type: "array",
    },
    segmentTarget: positiveNumber,
    sessionId: id,
    state: { enum: SESSION_STATES, type: "string" },
    tenantId: id,
  },
  required: [
    "createdAt",
    "epoch",
    "latencyProfile",
    "olos",
    "partTarget",
    "renditions",
    "segmentTarget",
    "sessionId",
    "state",
    "tenantId",
  ],
  title: "OLOS Session",
  type: "object",
} as const satisfies OlosJsonSchema;

export const OLOS_UPLOAD_SLOT_SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT,
  additionalProperties: false,
  properties: {
    contentType: nonEmptyString,
    deliveryUrl: nonEmptyString,
    duration: positiveNumber,
    epoch: nonNegativeInteger,
    expiresAt: timestamp,
    kind: { enum: MEDIA_OBJECT_KINDS, type: "string" },
    maxBytes: positiveNumber,
    mediaSequenceNumber: nonNegativeInteger,
    minBytes: positiveNumber,
    objectKey,
    partNumber: nonNegativeInteger,
    publicationMode: { enum: PUBLICATION_MODES, type: "string" },
    publisherInstanceId: id,
    renditionId: id,
    sessionId: id,
    slotId: id,
    state: { enum: UPLOAD_SLOT_STATES, type: "string" },
    tenantId: id,
  },
  required: [
    "contentType",
    "deliveryUrl",
    "duration",
    "epoch",
    "expiresAt",
    "kind",
    "maxBytes",
    "mediaSequenceNumber",
    "objectKey",
    "publicationMode",
    "publisherInstanceId",
    "renditionId",
    "sessionId",
    "slotId",
    "state",
    "tenantId",
  ],
  title: "OLOS UploadSlot",
  type: "object",
} as const satisfies OlosJsonSchema;

export const OLOS_COMMIT_SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT,
  additionalProperties: false,
  properties: {
    commitId: id,
    committedAt: timestamp,
    deliveryUrl: nonEmptyString,
    duration: positiveNumber,
    epoch: nonNegativeInteger,
    etag: nonEmptyString,
    independent: { type: "boolean" },
    mediaSequenceNumber: nonNegativeInteger,
    objectKey,
    partNumber: nonNegativeInteger,
    programDateTime: timestamp,
    providerId: id,
    publicationMode: { enum: PUBLICATION_MODES, type: "string" },
    renditionId: id,
    sessionId: id,
    size: positiveNumber,
    slotId: id,
  },
  required: [
    "commitId",
    "committedAt",
    "deliveryUrl",
    "duration",
    "epoch",
    "mediaSequenceNumber",
    "objectKey",
    "providerId",
    "publicationMode",
    "renditionId",
    "sessionId",
    "size",
    "slotId",
  ],
  title: "OLOS Commit",
  type: "object",
} as const satisfies OlosJsonSchema;

export const OLOS_PATHWAY_SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT,
  additionalProperties: false,
  properties: {
    baseUrl: nonEmptyString,
    pathwayId: id,
    priority: nonNegativeInteger,
    providerId: id,
    state: { enum: PATHWAY_STATES, type: "string" },
  },
  required: ["baseUrl", "pathwayId", "priority", "providerId", "state"],
  title: "OLOS Pathway",
  type: "object",
} as const satisfies OlosJsonSchema;

export const OLOS_COMMITTED_WINDOW_SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT,
  additionalProperties: false,
  properties: {
    discontinuitySequence: nonNegativeInteger,
    epoch: nonNegativeInteger,
    firstMediaSequenceNumber: nonNegativeInteger,
    lastMediaSequenceNumber: nonNegativeInteger,
    renditions: {
      additionalProperties: renditionWindowSchema,
      type: "object",
    },
  },
  required: [
    "discontinuitySequence",
    "epoch",
    "firstMediaSequenceNumber",
    "lastMediaSequenceNumber",
    "renditions",
  ],
  title: "OLOS CommittedWindow",
  type: "object",
} as const satisfies OlosJsonSchema;

export const OLOS_CURSOR_SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT,
  additionalProperties: false,
  properties: {
    committedWindow: OLOS_COMMITTED_WINDOW_SCHEMA,
    epoch: nonNegativeInteger,
    latencyProfile: { enum: LATENCY_PROFILES, type: "string" },
    olos: { const: "1.0" },
    partTarget: positiveNumber,
    pathways: { items: OLOS_PATHWAY_SCHEMA, type: "array" },
    segmentTarget: positiveNumber,
    sessionId: id,
    state: { enum: SESSION_STATES, type: "string" },
    tenantId: id,
    updatedAt: timestamp,
    window: {
      additionalProperties: false,
      properties: {
        firstMediaSequenceNumber: nonNegativeInteger,
        lastMediaSequenceNumber: nonNegativeInteger,
        lastPartNumber: nonNegativeInteger,
      },
      required: ["firstMediaSequenceNumber", "lastMediaSequenceNumber"],
      type: "object",
    },
  },
  required: [
    "committedWindow",
    "epoch",
    "latencyProfile",
    "olos",
    "partTarget",
    "pathways",
    "segmentTarget",
    "sessionId",
    "state",
    "tenantId",
    "updatedAt",
    "window",
  ],
  title: "OLOS Cursor",
  type: "object",
} as const satisfies OlosJsonSchema;

export const OLOS_JSON_SCHEMAS = {
  commit: OLOS_COMMIT_SCHEMA,
  committedWindow: OLOS_COMMITTED_WINDOW_SCHEMA,
  cursor: OLOS_CURSOR_SCHEMA,
  pathway: OLOS_PATHWAY_SCHEMA,
  session: OLOS_SESSION_SCHEMA,
  uploadSlot: OLOS_UPLOAD_SLOT_SCHEMA,
} as const;
