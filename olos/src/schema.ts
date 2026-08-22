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
  profileData,
  providerApiSchema,
  providerConsistencySchema,
  providerDeliverySchema,
  providerDirectObjectPublicationPrecondition,
  providerEventsSchema,
  providerPublicationSchema,
  providerUploadGrantSchema,
  streamProfile,
  stringEnum,
  timestamp,
  trackSchema,
  trackWindowSchema,
} from "./schema-fragments";
import { OLOS_ERROR_CODES } from "./types/errors";
import { PROVIDER_KINDS } from "./types/provider-capability";
import { SESSION_STATES } from "./types/session";
import { OBJECT_KINDS } from "./types/storage-object";
import { UPLOAD_SLOT_STATES } from "./types/upload-slot";

export type { OlosJsonSchema } from "./schema-fragments";
/**
 * JSON Schema (2020-12) for the wire-format `Session` document. The
 * session `profile` and each track `profile` are opaque objects here;
 * profile modules publish their own schemas for the contents (for example
 * olos/media).
 */
export const OLOS_SESSION_SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT,
  additionalProperties: false,
  properties: {
    createdAt: timestamp,
    epoch: nonNegativeInteger,
    olos: { const: "1.0" },
    profile: streamProfile,
    sessionId: id,
    state: stringEnum(SESSION_STATES),
    tracks: {
      items: trackSchema,
      minItems: 1,
      type: "array",
    },
  },
  required: [
    "createdAt",
    "epoch",
    "olos",
    "profile",
    "sessionId",
    "state",
    "tracks",
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
    epoch: nonNegativeInteger,
    expiresAt: timestamp,
    kind: stringEnum(OBJECT_KINDS),
    maxBytes: positiveInteger,
    minBytes: nonNegativeInteger,
    objectKey,
    partNumber: nonNegativeInteger,
    profile: profileData,
    sequenceNumber: nonNegativeInteger,
    sessionId: id,
    slotId: id,
    state: stringEnum(UPLOAD_SLOT_STATES),
    trackId: id,
  },
  required: [
    "contentType",
    "deliveryUrl",
    "epoch",
    "expiresAt",
    "kind",
    "maxBytes",
    "objectKey",
    "sequenceNumber",
    "sessionId",
    "slotId",
    "state",
    "trackId",
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
    epoch: nonNegativeInteger,
    etag: nonEmptyString,
    objectKey,
    partNumber: nonNegativeInteger,
    profile: profileData,
    sequenceNumber: nonNegativeInteger,
    sessionId: id,
    size: positiveInteger,
    slotId: id,
    trackId: id,
  },
  required: [
    "commitId",
    "committedAt",
    "deliveryUrl",
    "epoch",
    "objectKey",
    "sequenceNumber",
    "sessionId",
    "size",
    "slotId",
    "trackId",
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

/** JSON Schema (2020-12) for the wire-format `StorageObject` observation. */
export const OLOS_STORAGE_OBJECT_SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT,
  additionalProperties: false,
  properties: {
    contentType,
    etag: nonEmptyString,
    metadata: headerMap,
    objectKey,
    observedAt: timestamp,
    providerId: id,
    size: positiveInteger,
  },
  required: ["contentType", "objectKey", "observedAt", "providerId", "size"],
  title: "OLOS StorageObject",
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
    epoch: nonNegativeInteger,
    firstSequenceNumber: nonNegativeInteger,
    lastSequenceNumber: nonNegativeInteger,
    tracks: {
      additionalProperties: trackWindowSchema,
      type: "object",
    },
  },
  required: ["epoch", "firstSequenceNumber", "lastSequenceNumber", "tracks"],
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
    deliveryBaseUrl: deliveryUrl,
    epoch: nonNegativeInteger,
    olos: { const: "1.0" },
    profile: streamProfile,
    sessionId: id,
    state: stringEnum(SESSION_STATES),
    updatedAt: timestamp,
    window: {
      additionalProperties: false,
      properties: {
        firstSequenceNumber: nonNegativeInteger,
        lastPartNumber: nonNegativeInteger,
        lastSequenceNumber: nonNegativeInteger,
      },
      required: ["firstSequenceNumber", "lastSequenceNumber"],
      type: "object",
    },
  },
  required: [
    "committedWindow",
    "deliveryBaseUrl",
    "epoch",
    "olos",
    "profile",
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
  providerCapability: OLOS_PROVIDER_CAPABILITY_SCHEMA,
  session: OLOS_SESSION_SCHEMA,
  storageObject: OLOS_STORAGE_OBJECT_SCHEMA,
  uploadGrant: OLOS_UPLOAD_GRANT_SCHEMA,
  uploadSlot: OLOS_UPLOAD_SLOT_SCHEMA,
} as const;
