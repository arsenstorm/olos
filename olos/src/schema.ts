import { OLOS_ERROR_CODES } from "./config/errors";
import { MEDIA_OBJECT_KINDS } from "./config/media-object";
import { PATHWAY_STATES } from "./config/pathway";
import {
  PROVIDER_CONSISTENCY_LEVELS,
  PROVIDER_EVENT_DELIVERY_MODES,
  PROVIDER_KINDS,
} from "./config/provider-capability";
import {
  LATENCY_PROFILES,
  RENDITION_KINDS,
  SESSION_STATES,
} from "./config/session";
import { UPLOAD_SLOT_STATES } from "./config/upload-slot";
import { CONTENT_TYPE_SCHEMA_PATTERN } from "./validation/content-type";
import { HTTP_HEADER_NAME_SCHEMA_PATTERN } from "./validation/http-header";

export interface OlosJsonSchema {
  readonly [key: string]: unknown;
}

const JSON_SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema";
const JSON_SCHEMA_THEN = "then";
const ID_PATTERN = "^[A-Za-z0-9_-]+$";
const SAFE_OBJECT_KEY_PATTERN =
  "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).+[^/]$";

const id = { minLength: 1, pattern: ID_PATTERN, type: "string" } as const;
const nonEmptyString = { minLength: 1, type: "string" } as const;
const contentType = {
  pattern: CONTENT_TYPE_SCHEMA_PATTERN,
  type: "string",
} as const;
const nonNegativeInteger = { minimum: 0, type: "integer" } as const;
const positiveNumber = { exclusiveMinimum: 0, type: "number" } as const;
const timestamp = { format: "date-time", type: "string" } as const;
const absoluteHttpUrl = {
  format: "uri",
  minLength: 1,
  type: "string",
} as const;
const pathwayBaseUrl = {
  format: "uri",
  minLength: 1,
  pattern: "^https?://[^?#]+$",
  type: "string",
} as const;
const deliveryUrl = {
  minLength: 1,
  pattern:
    "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^?#]+)$",
  type: "string",
} as const;
const headerMap = {
  additionalProperties: { type: "string" },
  propertyNames: { pattern: HTTP_HEADER_NAME_SCHEMA_PATTERN },
  type: "object",
} as const;
const objectKey = {
  minLength: 1,
  pattern: SAFE_OBJECT_KEY_PATTERN,
  type: "string",
} as const;

function stringEnum<const Values extends readonly string[]>(values: Values) {
  return { enum: values, type: "string" } as const;
}

const byterangeSchema = {
  additionalProperties: false,
  properties: {
    length: { exclusiveMinimum: 0, type: "integer" },
    offset: { minimum: 0, type: "integer" },
    segmentDeliveryUrl: deliveryUrl,
    segmentObjectKey: objectKey,
  },
  required: ["length", "offset", "segmentDeliveryUrl", "segmentObjectKey"],
  type: "object",
} as const;

const providerApiSchema = {
  additionalProperties: false,
  properties: {
    family: nonEmptyString,
  },
  required: ["family"],
  type: "object",
} as const;

const providerConsistencySchema = {
  additionalProperties: false,
  properties: {
    headAfterCreate: stringEnum(PROVIDER_CONSISTENCY_LEVELS),
    listAfterCreate: stringEnum(PROVIDER_CONSISTENCY_LEVELS),
    readAfterCreate: stringEnum(PROVIDER_CONSISTENCY_LEVELS),
  },
  required: ["headAfterCreate", "readAfterCreate"],
  type: "object",
} as const;

const providerPublicationSchema = {
  additionalProperties: false,
  properties: {
    createIfAbsent: { type: "boolean" },
    directObjectPublication: { type: "boolean" },
    manifestGatedPublication: { type: "boolean" },
    overwritesAllowed: { type: "boolean" },
    privateUploadPublicPromotion: { type: "boolean" },
    readGateAvailable: { type: "boolean" },
  },
  required: ["createIfAbsent", "directObjectPublication"],
  type: "object",
} as const;

const providerUploadGrantSchema = {
  additionalProperties: false,
  anyOf: [
    {
      properties: {
        presignedPut: { const: true },
      },
      required: ["presignedPut"],
    },
    {
      properties: {
        temporaryCredentials: { const: true },
      },
      required: ["temporaryCredentials"],
    },
  ],
  properties: {
    contentTypeBound: { type: "boolean" },
    exactKey: { type: "boolean" },
    maxRecommendedTtlSeconds: { exclusiveMinimum: 0, type: "integer" },
    methodBound: { type: "boolean" },
    objectSizeCanBeObserved: { type: "boolean" },
    presignedPut: { type: "boolean" },
    requiredHeadersCanBeSigned: { type: "boolean" },
    temporaryCredentials: { type: "boolean" },
  },
  required: [
    "contentTypeBound",
    "exactKey",
    "methodBound",
    "objectSizeCanBeObserved",
    "requiredHeadersCanBeSigned",
  ],
  type: "object",
} as const;

const providerDeliverySchema = {
  additionalProperties: false,
  properties: {
    documentNavigationCanBeBlocked: { type: "boolean" },
    immutableCaching: { type: "boolean" },
    negativeCachingPolicyDeclared: { type: "boolean" },
    publicBaseUrl: pathwayBaseUrl,
    rangeRequests: { type: "boolean" },
  },
  required: ["negativeCachingPolicyDeclared", "publicBaseUrl"],
  type: "object",
} as const;

const providerEventsSchema = {
  additionalProperties: false,
  properties: {
    delivery: stringEnum(PROVIDER_EVENT_DELIVERY_MODES),
    objectCreated: { type: "boolean" },
  },
  type: "object",
} as const;

const providerDirectObjectPublicationCondition = {
  properties: {
    publication: {
      properties: {
        directObjectPublication: { const: true },
      },
      required: ["directObjectPublication"],
    },
  },
} as const;

const providerDirectObjectPublicationRequirements = {
  properties: {
    consistency: {
      properties: {
        headAfterCreate: { const: "strong" },
      },
      required: ["headAfterCreate"],
    },
    delivery: {
      properties: {
        negativeCachingPolicyDeclared: { const: true },
      },
      required: ["negativeCachingPolicyDeclared"],
    },
    publication: {
      properties: {
        manifestGatedPublication: { const: true },
        overwritesAllowed: { not: { const: true } },
      },
      required: ["manifestGatedPublication"],
    },
  },
} as const;

const providerDirectObjectPublicationPrecondition = {
  if: providerDirectObjectPublicationCondition,
  [JSON_SCHEMA_THEN]: providerDirectObjectPublicationRequirements,
} as const;

const committedObjectSchema = {
  additionalProperties: false,
  properties: {
    commitId: id,
    contentType,
    deliveryUrl,
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
    byterange: byterangeSchema,
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
    latencyProfile: stringEnum(LATENCY_PROFILES),
    olos: { const: "1.0" },
    partTarget: positiveNumber,
    renditions: {
      items: {
        additionalProperties: false,
        dependentRequired: {
          height: ["width"],
          width: ["height"],
        },
        properties: {
          bitrate: { exclusiveMinimum: 0, type: "integer" },
          channels: { exclusiveMinimum: 0, type: "integer" },
          codec: nonEmptyString,
          frameRate: positiveNumber,
          height: { exclusiveMinimum: 0, type: "integer" },
          kind: stringEnum(RENDITION_KINDS),
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
    state: stringEnum(SESSION_STATES),
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
    byterange: byterangeSchema,
    contentType,
    deliveryUrl,
    duration: positiveNumber,
    epoch: nonNegativeInteger,
    expiresAt: timestamp,
    kind: stringEnum(MEDIA_OBJECT_KINDS),
    maxBytes: positiveNumber,
    mediaSequenceNumber: nonNegativeInteger,
    minBytes: nonNegativeInteger,
    objectKey,
    partNumber: nonNegativeInteger,
    publisherInstanceId: id,
    renditionId: id,
    sessionId: id,
    slotId: id,
    state: stringEnum(UPLOAD_SLOT_STATES),
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
    byterange: byterangeSchema,
    commitId: id,
    committedAt: timestamp,
    deliveryUrl,
    duration: positiveNumber,
    epoch: nonNegativeInteger,
    etag: nonEmptyString,
    independent: { type: "boolean" },
    mediaSequenceNumber: nonNegativeInteger,
    objectKey,
    partNumber: nonNegativeInteger,
    programDateTime: timestamp,
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
    "renditionId",
    "sessionId",
    "size",
    "slotId",
  ],
  title: "OLOS Commit",
  type: "object",
} as const satisfies OlosJsonSchema;

export const OLOS_UPLOAD_GRANT_SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT,
  additionalProperties: false,
  properties: {
    expiresAt: timestamp,
    method: { const: "PUT" },
    requiredHeaders: headerMap,
    slotId: id,
    url: absoluteHttpUrl,
  },
  required: ["expiresAt", "method", "slotId", "url"],
  title: "OLOS UploadGrant",
  type: "object",
} as const satisfies OlosJsonSchema;

export const OLOS_MEDIA_OBJECT_SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT,
  additionalProperties: false,
  properties: {
    contentType,
    etag: nonEmptyString,
    objectKey,
    observedAt: timestamp,
    providerId: id,
    size: positiveNumber,
  },
  required: ["contentType", "objectKey", "observedAt", "providerId", "size"],
  title: "OLOS MediaObject",
  type: "object",
} as const satisfies OlosJsonSchema;

export const OLOS_PATHWAY_SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT,
  additionalProperties: false,
  properties: {
    baseUrl: pathwayBaseUrl,
    pathwayId: id,
    priority: nonNegativeInteger,
    providerId: id,
    state: stringEnum(PATHWAY_STATES),
  },
  required: ["baseUrl", "pathwayId", "priority", "providerId", "state"],
  title: "OLOS Pathway",
  type: "object",
} as const satisfies OlosJsonSchema;

export const OLOS_PROVIDER_CAPABILITY_SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT,
  additionalProperties: false,
  allOf: [providerDirectObjectPublicationPrecondition],
  properties: {
    api: providerApiSchema,
    consistency: providerConsistencySchema,
    delivery: providerDeliverySchema,
    events: providerEventsSchema,
    kind: stringEnum(PROVIDER_KINDS),
    olos: { const: "1.0" },
    providerId: id,
    publication: providerPublicationSchema,
    uploadGrants: providerUploadGrantSchema,
  },
  required: [
    "consistency",
    "delivery",
    "kind",
    "olos",
    "providerId",
    "publication",
    "uploadGrants",
  ],
  title: "OLOS ProviderCapabilityDocument",
  type: "object",
} as const satisfies OlosJsonSchema;

export const OLOS_ERROR_SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT,
  additionalProperties: false,
  properties: {
    error: {
      additionalProperties: false,
      properties: {
        code: stringEnum(OLOS_ERROR_CODES),
        details: { type: "object" },
        message: nonEmptyString,
      },
      required: ["code", "message"],
      type: "object",
    },
  },
  required: ["error"],
  title: "OLOS Error",
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
    latencyProfile: stringEnum(LATENCY_PROFILES),
    olos: { const: "1.0" },
    partTarget: positiveNumber,
    pathways: { items: OLOS_PATHWAY_SCHEMA, type: "array" },
    segmentTarget: positiveNumber,
    sessionId: id,
    state: stringEnum(SESSION_STATES),
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
  error: OLOS_ERROR_SCHEMA,
  mediaObject: OLOS_MEDIA_OBJECT_SCHEMA,
  pathway: OLOS_PATHWAY_SCHEMA,
  providerCapability: OLOS_PROVIDER_CAPABILITY_SCHEMA,
  session: OLOS_SESSION_SCHEMA,
  uploadGrant: OLOS_UPLOAD_GRANT_SCHEMA,
  uploadSlot: OLOS_UPLOAD_SLOT_SCHEMA,
} as const;
