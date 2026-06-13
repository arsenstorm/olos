import { describe, expect, test } from "bun:test";
import { OLOS_ERROR_CODES } from "./config/errors";
import { MEDIA_OBJECT_KINDS } from "./config/media-object";
import { PROVIDER_KINDS } from "./config/provider-capability";
import { PUBLICATION_MODES } from "./config/publication";
import { LATENCY_PROFILES, SESSION_STATES } from "./config/session";
import {
  OLOS_COMMIT_SCHEMA,
  OLOS_ERROR_SCHEMA,
  OLOS_JSON_SCHEMAS,
  OLOS_MEDIA_OBJECT_SCHEMA,
  OLOS_PROVIDER_CAPABILITY_SCHEMA,
  OLOS_SESSION_SCHEMA,
  OLOS_UPLOAD_GRANT_SCHEMA,
  OLOS_UPLOAD_SLOT_SCHEMA,
} from "./schema";

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
    expect(OLOS_COMMIT_SCHEMA.properties.publicationMode.enum).toEqual(
      PUBLICATION_MODES
    );
  });

  test("closes fixed-shape core objects", () => {
    expect(OLOS_SESSION_SCHEMA.additionalProperties).toBe(false);
    expect(OLOS_SESSION_SCHEMA.properties.renditions.items).toMatchObject({
      additionalProperties: false,
    });
    expect(OLOS_UPLOAD_SLOT_SCHEMA.additionalProperties).toBe(false);
    expect(OLOS_COMMIT_SCHEMA.additionalProperties).toBe(false);
  });

  test("describes remaining exported wire objects", () => {
    expect(OLOS_UPLOAD_GRANT_SCHEMA.properties.method).toEqual({
      const: "PUT",
    });
    expect(OLOS_MEDIA_OBJECT_SCHEMA.properties.providerId).toMatchObject({
      pattern: "^[A-Za-z0-9_-]+$",
    });
    expect(Object.hasOwn(OLOS_MEDIA_OBJECT_SCHEMA.properties, "kind")).toBe(
      false
    );
    expect(OLOS_PROVIDER_CAPABILITY_SCHEMA.properties.kind.enum).toEqual(
      PROVIDER_KINDS
    );
    expect(
      OLOS_PROVIDER_CAPABILITY_SCHEMA.properties.uploadGrants.properties
        .presignedPut
    ).toEqual({ type: "boolean" });
    expect(OLOS_ERROR_SCHEMA.properties.error.properties.code.enum).toEqual(
      OLOS_ERROR_CODES
    );
    expect(OLOS_UPLOAD_SLOT_SCHEMA.properties.kind.enum).toEqual(
      MEDIA_OBJECT_KINDS
    );
  });

  test("describes provider capability preconditions", () => {
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
        publication: {
          properties: {
            overwritesAllowed: {
              not: { const: true },
            },
          },
        },
      },
    });
  });
});
