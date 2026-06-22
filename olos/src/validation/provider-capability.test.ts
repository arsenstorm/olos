import { describe, expect, test } from "bun:test";
import type { ProviderCapabilityDocument } from "../types/provider-capability";
import {
  assertProviderCapabilityDocument,
  isProviderCapabilityDocument,
} from "./provider-capability";

const capability: ProviderCapabilityDocument = {
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
};

describe("provider capability validation", () => {
  test("accepts a valid provider capability document", () => {
    expect(isProviderCapabilityDocument(capability)).toBe(true);
    expect(() => assertProviderCapabilityDocument(capability)).not.toThrow();
  });

  test("rejects unsupported wire versions", () => {
    expect(() =>
      assertProviderCapabilityDocument({ ...capability, olos: "2.0" })
    ).toThrow("providerCapability.olos must be 1.0");
  });

  test("rejects unsafe provider IDs", () => {
    expect(() =>
      assertProviderCapabilityDocument({
        ...capability,
        providerId: "../r2",
      })
    ).toThrow(
      "providerCapability.providerId must be a non-empty URL-safe identifier"
    );
  });

  test("rejects unknown provider kinds", () => {
    expect(() =>
      assertProviderCapabilityDocument({ ...capability, kind: "cdn" })
    ).toThrow("providerCapability.kind must be one of: object-store");
  });

  test("rejects direct publication without strong head-after-create", () => {
    expect(() =>
      assertProviderCapabilityDocument({
        ...capability,
        consistency: {
          ...capability.consistency,
          headAfterCreate: "eventual",
        },
      })
    ).toThrow(
      "providerCapability.consistency.headAfterCreate must be strong for direct object publication"
    );
  });

  test("rejects direct publication with overwrites allowed", () => {
    expect(() =>
      assertProviderCapabilityDocument({
        ...capability,
        publication: {
          ...capability.publication,
          overwritesAllowed: true,
        },
      })
    ).toThrow(
      "providerCapability.publication.overwritesAllowed must not be true for direct object publication"
    );
  });

  test("rejects direct publication without manifest-gated publication", () => {
    expect(() =>
      assertProviderCapabilityDocument({
        ...capability,
        publication: {
          ...capability.publication,
          manifestGatedPublication: false,
        },
      })
    ).toThrow(
      "providerCapability.publication.manifestGatedPublication must be true for direct object publication"
    );
  });

  test("rejects direct publication without negative caching policy", () => {
    expect(() =>
      assertProviderCapabilityDocument({
        ...capability,
        delivery: {
          ...capability.delivery,
          negativeCachingPolicyDeclared: false,
        },
      })
    ).toThrow(
      "providerCapability.delivery.negativeCachingPolicyDeclared must be true for direct object publication"
    );
  });

  test("rejects capabilities without an upload grant mechanism", () => {
    expect(() =>
      assertProviderCapabilityDocument({
        ...capability,
        uploadGrants: {
          contentTypeBound: true,
          exactKey: true,
          methodBound: true,
          objectSizeCanBeObserved: true,
          requiredHeadersCanBeSigned: true,
        },
      })
    ).toThrow(
      "providerCapability.uploadGrants must support presignedPut or temporaryCredentials"
    );
  });

  test("accepts temporary-credential upload grants without presigned PUT", () => {
    expect(() =>
      assertProviderCapabilityDocument({
        ...capability,
        uploadGrants: {
          ...capability.uploadGrants,
          presignedPut: false,
          temporaryCredentials: true,
        },
      })
    ).not.toThrow();
  });

  test("rejects missing upload grant safety declarations", () => {
    expect(() =>
      assertProviderCapabilityDocument({
        ...capability,
        uploadGrants: {
          contentTypeBound: true,
          methodBound: true,
          objectSizeCanBeObserved: true,
          presignedPut: true,
          requiredHeadersCanBeSigned: true,
        },
      })
    ).toThrow("providerCapability.uploadGrants.exactKey must be a boolean");
  });

  test("rejects invalid upload grant TTLs", () => {
    expect(() =>
      assertProviderCapabilityDocument({
        ...capability,
        uploadGrants: {
          ...capability.uploadGrants,
          maxRecommendedTtlSeconds: 0,
        },
      })
    ).toThrow(
      "providerCapability.uploadGrants.maxRecommendedTtlSeconds must be a positive integer"
    );
  });

  test("rejects invalid public base URLs", () => {
    expect(() =>
      assertProviderCapabilityDocument({
        ...capability,
        delivery: {
          ...capability.delivery,
          publicBaseUrl: "r2://bucket",
        },
      })
    ).toThrow(
      "providerCapability.delivery.publicBaseUrl must be an absolute HTTP(S) URL"
    );

    expect(() =>
      assertProviderCapabilityDocument({
        ...capability,
        delivery: {
          ...capability.delivery,
          publicBaseUrl: "https://media.example.com/live?token=abc",
        },
      })
    ).toThrow(
      "providerCapability.delivery.publicBaseUrl must not contain query strings or fragments"
    );

    expect(() =>
      assertProviderCapabilityDocument({
        ...capability,
        delivery: {
          ...capability.delivery,
          publicBaseUrl: "https://media.example.com/live#media",
        },
      })
    ).toThrow(
      "providerCapability.delivery.publicBaseUrl must not contain query strings or fragments"
    );
  });

  test("rejects missing negative caching declarations", () => {
    expect(() =>
      assertProviderCapabilityDocument({
        ...capability,
        delivery: {
          ...capability.delivery,
          negativeCachingPolicyDeclared: undefined,
        },
      })
    ).toThrow(
      "providerCapability.delivery.negativeCachingPolicyDeclared must be a boolean"
    );
  });

  test("rejects invalid optional delivery booleans", () => {
    expect(() =>
      assertProviderCapabilityDocument({
        ...capability,
        delivery: {
          ...capability.delivery,
          rangeRequests: "yes",
        },
      })
    ).toThrow("providerCapability.delivery.rangeRequests must be a boolean");
  });

  test("accepts read-gated providers without direct object publication", () => {
    expect(() =>
      assertProviderCapabilityDocument({
        ...capability,
        consistency: {
          ...capability.consistency,
          headAfterCreate: "eventual",
        },
        publication: {
          ...capability.publication,
          directObjectPublication: false,
          readGateAvailable: true,
        },
        delivery: {
          ...capability.delivery,
          negativeCachingPolicyDeclared: false,
        },
      })
    ).not.toThrow();
  });
});
