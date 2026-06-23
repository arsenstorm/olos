import { describe, expect, test } from "bun:test";
import { OLOS_ERROR_CODES } from "./config/errors";
import { MEDIA_OBJECT_KINDS } from "./config/media-object";
import {
  PROVIDER_EVENT_DELIVERY_MODES,
  PROVIDER_KINDS,
} from "./config/provider-capability";
import { PUBLICATION_MODES } from "./config/publication";
import { LATENCY_PROFILES, SESSION_STATES } from "./config/session";
import {
  OLOS_COMMIT_SCHEMA,
  OLOS_ERROR_SCHEMA,
  OLOS_JSON_SCHEMAS,
  OLOS_MEDIA_OBJECT_SCHEMA,
  OLOS_PATHWAY_SCHEMA,
  OLOS_PROVIDER_CAPABILITY_SCHEMA,
  OLOS_SESSION_SCHEMA,
  OLOS_UPLOAD_GRANT_SCHEMA,
  OLOS_UPLOAD_SLOT_SCHEMA,
} from "./schema";
import { CONTENT_TYPE_SCHEMA_PATTERN } from "./validation/content-type";

describe("OLOS JSON schemas", () => {
  test("exports stable wire schema names", () => {
    expect(Object.keys(OLOS_JSON_SCHEMAS).sort()).toEqual([
      "commit",
      "committedWindow",
      "cursor",
      "error",
      "mediaObject",
      "pathway",
      "providerCapability",
      "session",
      "uploadGrant",
      "uploadSlot",
    ]);
  });

  test("describes the session wire version and enums", () => {
    expect(OLOS_SESSION_SCHEMA.properties.olos).toEqual({ const: "1.0" });
    expect(OLOS_SESSION_SCHEMA.properties.state.enum).toEqual(SESSION_STATES);
    expect(OLOS_SESSION_SCHEMA.properties.latencyProfile.enum).toEqual(
      LATENCY_PROFILES
    );
    expect(OLOS_SESSION_SCHEMA.required).toContain("renditions");
  });

  test("describes upload slot and commit object keys", () => {
    expect(OLOS_UPLOAD_SLOT_SCHEMA.required).toContain("objectKey");
    expect(OLOS_COMMIT_SCHEMA.required).toContain("objectKey");
    expect(OLOS_UPLOAD_SLOT_SCHEMA.properties.minBytes).toEqual({
      minimum: 0,
      type: "integer",
    });
    expect(OLOS_UPLOAD_SLOT_SCHEMA.properties.deliveryUrl).toMatchObject({
      pattern:
        "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^?#]+)$",
    });
    expect(OLOS_UPLOAD_SLOT_SCHEMA.properties.contentType).toMatchObject({
      pattern: CONTENT_TYPE_SCHEMA_PATTERN,
    });
    expect(OLOS_COMMIT_SCHEMA.properties.deliveryUrl).toMatchObject({
      pattern:
        "^(?:(?!.*(?:^|/)(?:\\.|\\.\\.)(?:/|$))(?!.*//)/[^?#]+|https?://[^?#]+)$",
    });
    expect(OLOS_COMMIT_SCHEMA.properties.publicationMode.enum).toEqual(
      PUBLICATION_MODES
    );
  });

  test("closes fixed-shape core objects", () => {
    expect(OLOS_SESSION_SCHEMA.additionalProperties).toBe(false);
    expect(OLOS_SESSION_SCHEMA.properties.renditions.items).toMatchObject({
      additionalProperties: false,
      dependentRequired: {
        height: ["width"],
        width: ["height"],
      },
    });
    expect(OLOS_UPLOAD_SLOT_SCHEMA.additionalProperties).toBe(false);
    expect(OLOS_COMMIT_SCHEMA.additionalProperties).toBe(false);
  });

  test("describes remaining exported wire objects", () => {
    expect(OLOS_UPLOAD_GRANT_SCHEMA.properties.method).toEqual({
      const: "PUT",
    });
    expect(OLOS_UPLOAD_GRANT_SCHEMA.properties.requiredHeaders).toMatchObject({
      propertyNames: { pattern: "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+$" },
    });
    expect(OLOS_MEDIA_OBJECT_SCHEMA.properties.providerId).toMatchObject({
      pattern: "^[A-Za-z0-9_-]+$",
    });
    expect(OLOS_MEDIA_OBJECT_SCHEMA.properties.contentType).toMatchObject({
      pattern: CONTENT_TYPE_SCHEMA_PATTERN,
    });
    expect(Object.hasOwn(OLOS_MEDIA_OBJECT_SCHEMA.properties, "kind")).toBe(
      false
    );
    expect(OLOS_PROVIDER_CAPABILITY_SCHEMA.properties.kind.enum).toEqual(
      PROVIDER_KINDS
    );
    expect(
      OLOS_PROVIDER_CAPABILITY_SCHEMA.properties.events.properties.delivery.enum
    ).toEqual(PROVIDER_EVENT_DELIVERY_MODES);
    expect(
      OLOS_PROVIDER_CAPABILITY_SCHEMA.properties.uploadGrants.properties
        .presignedPut
    ).toEqual({ type: "boolean" });
    expect(
      OLOS_PROVIDER_CAPABILITY_SCHEMA.properties.delivery.properties
        .publicBaseUrl
    ).toMatchObject({
      format: "uri",
      pattern: "^https?://[^?#]+$",
    });
    expect(OLOS_ERROR_SCHEMA.properties.error.properties.code.enum).toEqual(
      OLOS_ERROR_CODES
    );
    expect(OLOS_UPLOAD_SLOT_SCHEMA.properties.kind.enum).toEqual(
      MEDIA_OBJECT_KINDS
    );
    expect(OLOS_PATHWAY_SCHEMA.properties.baseUrl).toMatchObject({
      format: "uri",
      pattern: "^https?://[^?#]+$",
    });
    expect(OLOS_PATHWAY_SCHEMA.required).toContain("state");
  });

  test("describes provider capability preconditions", () => {
    expect(OLOS_PROVIDER_CAPABILITY_SCHEMA.allOf).toHaveLength(1);

    expect(
      OLOS_PROVIDER_CAPABILITY_SCHEMA.properties.uploadGrants.anyOf
    ).toEqual([
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
    ]);
    expect(
      OLOS_PROVIDER_CAPABILITY_SCHEMA.properties.uploadGrants.required
    ).toEqual([
      "contentTypeBound",
      "exactKey",
      "methodBound",
      "objectSizeCanBeObserved",
      "requiredHeadersCanBeSigned",
    ]);
    const directPublicationPrecondition =
      OLOS_PROVIDER_CAPABILITY_SCHEMA.allOf[0];

    expect(directPublicationPrecondition.if).toEqual({
      properties: {
        publication: {
          properties: {
            directObjectPublication: { const: true },
          },
          required: ["directObjectPublication"],
        },
      },
    });
    expect(directPublicationPrecondition.then).toEqual({
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
            manifestGatedPublication: {
              const: true,
            },
            overwritesAllowed: {
              not: { const: true },
            },
          },
          required: ["manifestGatedPublication"],
        },
      },
    });
  });
});
