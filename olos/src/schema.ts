import { OLOS_ERROR_CODES } from "./config/errors";
import { MEDIA_OBJECT_KINDS } from "./config/media-object";
import { PROVIDER_KINDS } from "./config/provider-capability";
import {
  LATENCY_PROFILES,
  RENDITION_KINDS,
  SESSION_STATES,
} from "./config/session";
import { UPLOAD_SLOT_STATES } from "./config/upload-slot";
import {
  absoluteHttpUrl,
  byterangeSchema,
  contentType,
  deliveryUrl,
  headerMap,
  id,
  JSON_SCHEMA_DRAFT,
  nonEmptyString,
  nonNegativeInteger,
  type OlosJsonSchema,
  objectKey,
  positiveInteger,
  positiveNumber,
  providerApiSchema,
  providerConsistencySchema,
  providerDeliverySchema,
  providerDirectObjectPublicationPrecondition,
  providerEventsSchema,
  providerPublicationSchema,
  providerUploadGrantSchema,
  renditionAudioGroupFieldsPrecondition,
  renditionWindowSchema,
  stringEnum,
  timestamp,
} from "./schema-fragments";

export type { OlosJsonSchema } from "./schema-fragments";
/**
 * JSON Schema (2020-12) for the wire-format `Session` document. Note the
 * audio-group constraints that span sibling renditions (single group, at
 * most one default) are only enforced by `assertSession`
 * (olos/validation), not by this schema.
 */
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
        allOf: [renditionAudioGroupFieldsPrecondition],
        dependentRequired: {
          height: ["width"],
          width: ["height"],
        },
        properties: {
          bitrate: { exclusiveMinimum: 0, type: "integer" },
          channels: { exclusiveMinimum: 0, type: "integer" },
          codec: nonEmptyString,
          defaultRendition: { type: "boolean" },
          frameRate: positiveNumber,
          groupId: id,
          height: { exclusiveMinimum: 0, type: "integer" },
          kind: stringEnum(RENDITION_KINDS),
          name: nonEmptyString,
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
  ],
  title: "OLOS Session",
  type: "object",
} as const satisfies OlosJsonSchema;

/**
 * JSON Schema (2020-12) for the wire-format `UploadSlot` document. JSON
 * Schema cannot express the sibling relation `minBytes <= maxBytes`; only
 * the runtime validator (`assertUploadSlot`) enforces it. The drift harness
 * covers the gap via its validator-only invalid payloads.
 */
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
    maxBytes: positiveInteger,
    mediaSequenceNumber: nonNegativeInteger,
    minBytes: nonNegativeInteger,
    objectKey,
    partNumber: nonNegativeInteger,
    renditionId: id,
    sessionId: id,
    slotId: id,
    state: stringEnum(UPLOAD_SLOT_STATES),
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
    "renditionId",
    "sessionId",
    "slotId",
    "state",
  ],
  title: "OLOS UploadSlot",
  type: "object",
} as const satisfies OlosJsonSchema;

/** JSON Schema (2020-12) for the wire-format `Commit` document. */
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
    size: positiveInteger,
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

/** JSON Schema (2020-12) for the wire-format `UploadGrant` document. */
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

/** JSON Schema (2020-12) for the wire-format `MediaObject` observation. */
export const OLOS_MEDIA_OBJECT_SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT,
  additionalProperties: false,
  properties: {
    contentType,
    etag: nonEmptyString,
    objectKey,
    observedAt: timestamp,
    providerId: id,
    size: positiveInteger,
  },
  required: ["contentType", "objectKey", "observedAt", "providerId", "size"],
  title: "OLOS MediaObject",
  type: "object",
} as const satisfies OlosJsonSchema;

/**
 * JSON Schema (2020-12) for `ProviderCapabilityDocument`, including the
 * conditional preconditions a provider must meet before declaring
 * `directObjectPublication`.
 */
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

/**
 * JSON Schema (2020-12) for the OLOS error body: an `error` object with a
 * known `olos.*` code, a message, and optional `details`.
 */
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

/**
 * JSON Schema (2020-12) for the `CommittedWindow` document. Ordering
 * invariants (monotonic, duplicate-free sequence and part numbers) are only
 * enforced by `assertCommittedWindow` (olos/validation).
 */
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

/**
 * JSON Schema (2020-12) for the wire-format `Cursor` document, embedding
 * `OLOS_COMMITTED_WINDOW_SCHEMA` for its `committedWindow` field.
 */
export const OLOS_CURSOR_SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT,
  additionalProperties: false,
  properties: {
    committedWindow: OLOS_COMMITTED_WINDOW_SCHEMA,
    epoch: nonNegativeInteger,
    latencyProfile: stringEnum(LATENCY_PROFILES),
    mediaBaseUrl: deliveryUrl,
    olos: { const: "1.0" },
    partTarget: positiveNumber,
    segmentTarget: positiveNumber,
    sessionId: id,
    state: stringEnum(SESSION_STATES),
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
    "mediaBaseUrl",
    "olos",
    "partTarget",
    "segmentTarget",
    "sessionId",
    "state",
    "updatedAt",
    "window",
  ],
  title: "OLOS Cursor",
  type: "object",
} as const satisfies OlosJsonSchema;

/**
 * All OLOS wire-format schemas keyed by document name — convenient for
 * registering the whole set with a validator in one pass.
 */
export const OLOS_JSON_SCHEMAS = {
  commit: OLOS_COMMIT_SCHEMA,
  committedWindow: OLOS_COMMITTED_WINDOW_SCHEMA,
  cursor: OLOS_CURSOR_SCHEMA,
  error: OLOS_ERROR_SCHEMA,
  mediaObject: OLOS_MEDIA_OBJECT_SCHEMA,
  providerCapability: OLOS_PROVIDER_CAPABILITY_SCHEMA,
  session: OLOS_SESSION_SCHEMA,
  uploadGrant: OLOS_UPLOAD_GRANT_SCHEMA,
  uploadSlot: OLOS_UPLOAD_SLOT_SCHEMA,
} as const;
