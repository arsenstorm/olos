import {
  PROVIDER_CONSISTENCY_LEVELS,
  PROVIDER_EVENT_DELIVERY_MODES,
} from "./types/provider-capability";
import { CONTENT_TYPE_SCHEMA_PATTERN } from "./validation/content-type";
import { RFC3339_TIMESTAMP_SCHEMA_PATTERN } from "./validation/fields";
import { HTTP_HEADER_NAME_SCHEMA_PATTERN } from "./validation/http-header";
/**
 * A JSON Schema document as exported by olos/schema: a plain readonly
 * object ready to hand to any JSON Schema 2020-12 validator (e.g. Ajv).
 */
export interface OlosJsonSchema {
  readonly [key: string]: unknown;
}

export const JSON_SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema";
const JSON_SCHEMA_THEN = "then";
const ID_PATTERN = "^[A-Za-z0-9._-]+$";
const SAFE_OBJECT_KEY_PATTERN =
  "^(?!/)(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)(?!.*[?#]).*[^/]$";

export const id = {
  minLength: 1,
  pattern: ID_PATTERN,
  type: "string",
} as const;
export const nonEmptyString = { minLength: 1, type: "string" } as const;
export const contentType = {
  pattern: CONTENT_TYPE_SCHEMA_PATTERN,
  type: "string",
} as const;
export const nonNegativeInteger = { minimum: 0, type: "integer" } as const;
export const positiveInteger = {
  exclusiveMinimum: 0,
  type: "integer",
} as const;
export const positiveNumber = { exclusiveMinimum: 0, type: "number" } as const;
// `pattern` narrows `format` to the grammar the runtime validators enforce;
// "full" format validation still rejects impossible calendar dates the
// pattern cannot express.
export const timestamp = {
  format: "date-time",
  pattern: RFC3339_TIMESTAMP_SCHEMA_PATTERN,
  type: "string",
} as const;
export const absoluteHttpUrl = {
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
export const deliveryUrl = {
  minLength: 1,
  pattern:
    "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^/?#]+(?:/(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)[^?#]*)?)$",
  type: "string",
} as const;
export const headerMap = {
  additionalProperties: { type: "string" },
  propertyNames: { pattern: HTTP_HEADER_NAME_SCHEMA_PATTERN },
  type: "object",
} as const;
export const objectKey = {
  minLength: 1,
  pattern: SAFE_OBJECT_KEY_PATTERN,
  type: "string",
} as const;
/**
 * Opaque profile data: any JSON object. Profile modules publish their own
 * schemas for the contents (for example `OLOS_MEDIA_*_PROFILE_SCHEMA` from
 * olos/media).
 */
export const profileData = { type: "object" } as const;
/** A session profile: any JSON object with a non-empty string `id`. */
export const streamProfile = {
  properties: { id: nonEmptyString },
  required: ["id"],
  type: "object",
} as const;

export function stringEnum<const Values extends readonly string[]>(
  values: Values
) {
  return { enum: values, type: "string" } as const;
}

export const byterangeSchema = {
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

export const trackSchema = {
  additionalProperties: false,
  properties: {
    contentType,
    profile: profileData,
    trackId: id,
  },
  required: ["trackId"],
  type: "object",
} as const;

export const providerApiSchema = {
  additionalProperties: false,
  properties: {
    family: nonEmptyString,
  },
  required: ["family"],
  type: "object",
} as const;

export const providerConsistencySchema = {
  additionalProperties: false,
  properties: {
    observeAfterCreate: stringEnum(PROVIDER_CONSISTENCY_LEVELS),
    listAfterCreate: stringEnum(PROVIDER_CONSISTENCY_LEVELS),
    readAfterCreate: stringEnum(PROVIDER_CONSISTENCY_LEVELS),
  },
  required: ["observeAfterCreate", "readAfterCreate"],
  type: "object",
} as const;

export const providerPublicationSchema = {
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

export const providerUploadGrantSchema = {
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

export const providerDeliverySchema = {
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

export const providerEventsSchema = {
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
        observeAfterCreate: { const: "strong" },
      },
      required: ["observeAfterCreate"],
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

export const providerDirectObjectPublicationPrecondition = {
  if: providerDirectObjectPublicationCondition,
  [JSON_SCHEMA_THEN]: providerDirectObjectPublicationRequirements,
} as const;

export const committedObjectSchema = {
  additionalProperties: false,
  properties: {
    commitId: id,
    contentType,
    deliveryUrl,
    etag: nonEmptyString,
    objectKey,
    profile: profileData,
    slotId: id,
  },
  required: ["commitId", "deliveryUrl", "objectKey", "slotId"],
  type: "object",
} as const;

export const committedPartSchema = {
  additionalProperties: false,
  properties: {
    ...committedObjectSchema.properties,
    byterange: byterangeSchema,
    partNumber: nonNegativeInteger,
  },
  required: [...committedObjectSchema.required, "partNumber"],
  type: "object",
} as const;

export const committedSegmentSchema = {
  additionalProperties: false,
  properties: {
    parts: { items: committedPartSchema, type: "array" },
    segment: committedObjectSchema,
    sequenceNumber: nonNegativeInteger,
  },
  required: ["sequenceNumber"],
  type: "object",
} as const;

export const trackWindowSchema = {
  additionalProperties: false,
  properties: {
    init: committedObjectSchema,
    profile: profileData,
    segments: { items: committedSegmentSchema, type: "array" },
    trackId: id,
  },
  required: ["segments", "trackId"],
  type: "object",
} as const;
