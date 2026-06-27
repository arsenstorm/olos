import { describe, expect, test } from "bun:test";
import type { ProviderCapabilityDocument } from "../types/provider-capability";
import type { UploadSlot } from "../types/upload-slot";
import {
  assertProviderCanIssueUploadGrant,
  canProviderIssueUploadGrant,
} from "./provider-upload-grant-policy";

const capability: ProviderCapabilityDocument = {
  api: {
    family: "s3-compatible",
  },
  consistency: {
    headAfterCreate: "strong",
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

const slot: UploadSlot = {
  contentType: "video/mp4",
  deliveryUrl: "/objects/tenant/session/v1080/3810.m4s",
  duration: 2,
  epoch: 0,
  expiresAt: "2026-01-01T00:00:05.000Z",
  kind: "segment",
  maxBytes: 100_000,
  mediaSequenceNumber: 3810,
  objectKey: "tenant/session/v1080/3810.m4s",
  publisherInstanceId: "pub_1",
  renditionId: "v1080",
  sessionId: "session_1",
  slotId: "slot_1",
  state: "issued",
  tenantId: "tenant_1",
};

describe("provider upload grant policy", () => {
  test("allows a safe direct-public upload grant policy", () => {
    expect(
      canProviderIssueUploadGrant({
        capability,
        grantTtlSeconds: 30,
        slot,
      })
    ).toBe(true);
  });

  test("rejects providers without presigned PUT support by default", () => {
    expect(() =>
      assertProviderCanIssueUploadGrant({
        capability: {
          ...capability,
          uploadGrants: {
            ...capability.uploadGrants,
            presignedPut: false,
          },
        },
        slot,
      })
    ).toThrow("providerCapability.uploadGrants.presignedPut must be true");
  });

  test("allows temporary credential policies when presigned PUT is not required", () => {
    expect(() =>
      assertProviderCanIssueUploadGrant({
        capability: {
          ...capability,
          uploadGrants: {
            ...capability.uploadGrants,
            presignedPut: false,
            temporaryCredentials: true,
          },
        },
        requirePresignedPut: false,
        slot,
      })
    ).not.toThrow();
  });

  test("allows missing grant safeguards when requirements are disabled", () => {
    expect(() =>
      assertProviderCanIssueUploadGrant({
        capability: {
          ...capability,
          publication: {
            ...capability.publication,
            createIfAbsent: false,
          },
          uploadGrants: {
            ...capability.uploadGrants,
            contentTypeBound: false,
            exactKey: false,
            methodBound: false,
            objectSizeCanBeObserved: false,
            presignedPut: false,
            requiredHeadersCanBeSigned: false,
          },
        },
        requireContentTypeBound: false,
        requireCreateIfAbsent: false,
        requireExactKey: false,
        requireMethodBound: false,
        requireObjectSizeObservation: false,
        requirePresignedPut: false,
        requireSignedRequiredHeaders: false,
        slot,
      })
    ).not.toThrow();
  });

  test("rejects providers without exact-key grants", () => {
    expect(() =>
      assertProviderCanIssueUploadGrant({
        capability: {
          ...capability,
          uploadGrants: {
            ...capability.uploadGrants,
            exactKey: false,
          },
        },
        slot,
      })
    ).toThrow("providerCapability.uploadGrants.exactKey must be true");
  });

  test("rejects providers without method-bound grants", () => {
    expect(() =>
      assertProviderCanIssueUploadGrant({
        capability: {
          ...capability,
          uploadGrants: {
            ...capability.uploadGrants,
            methodBound: false,
          },
        },
        slot,
      })
    ).toThrow("providerCapability.uploadGrants.methodBound must be true");
  });

  test("rejects providers without content-type-bound grants", () => {
    expect(() =>
      assertProviderCanIssueUploadGrant({
        capability: {
          ...capability,
          uploadGrants: {
            ...capability.uploadGrants,
            contentTypeBound: false,
          },
        },
        slot,
      })
    ).toThrow("providerCapability.uploadGrants.contentTypeBound must be true");
  });

  test("rejects providers that cannot sign required headers", () => {
    expect(() =>
      assertProviderCanIssueUploadGrant({
        capability: {
          ...capability,
          uploadGrants: {
            ...capability.uploadGrants,
            requiredHeadersCanBeSigned: false,
          },
        },
        slot,
      })
    ).toThrow(
      "providerCapability.uploadGrants.requiredHeadersCanBeSigned must be true"
    );
  });

  test("rejects providers that cannot observe object size", () => {
    expect(() =>
      assertProviderCanIssueUploadGrant({
        capability: {
          ...capability,
          uploadGrants: {
            ...capability.uploadGrants,
            objectSizeCanBeObserved: false,
          },
        },
        slot,
      })
    ).toThrow(
      "providerCapability.uploadGrants.objectSizeCanBeObserved must be true"
    );
  });

  test("rejects providers without create-if-absent support", () => {
    expect(() =>
      assertProviderCanIssueUploadGrant({
        capability: {
          ...capability,
          publication: {
            ...capability.publication,
            createIfAbsent: false,
          },
        },
        slot,
      })
    ).toThrow("providerCapability.publication.createIfAbsent must be true");
  });

  test("rejects providers that cannot issue OLOS-required upload grants", () => {
    expect(
      canProviderIssueUploadGrant({
        capability: {
          ...capability,
          publication: {
            ...capability.publication,
            createIfAbsent: false,
          },
          uploadGrants: {
            ...capability.uploadGrants,
            requiredHeadersCanBeSigned: false,
          },
        },
        slot,
      })
    ).toBe(false);
  });

  test("rejects grants above the provider recommended TTL", () => {
    expect(() =>
      assertProviderCanIssueUploadGrant({
        capability,
        grantTtlSeconds: 61,
        slot,
      })
    ).toThrow(
      "grantTtlSeconds must be less than or equal to providerCapability.uploadGrants.maxRecommendedTtlSeconds"
    );
  });

  test("allows grants at the provider recommended TTL", () => {
    expect(() =>
      assertProviderCanIssueUploadGrant({
        capability,
        grantTtlSeconds: 60,
        slot,
      })
    ).not.toThrow();
  });

  test.each([
    0,
    -1,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid grant TTL %p", (grantTtlSeconds) => {
    expect(() =>
      assertProviderCanIssueUploadGrant({
        capability,
        grantTtlSeconds,
        slot,
      })
    ).toThrow("grantTtlSeconds must be a positive finite number");
  });

  test("rejects direct-public slots without direct publication support", () => {
    expect(() =>
      assertProviderCanIssueUploadGrant({
        capability: {
          ...capability,
          publication: {
            ...capability.publication,
            directObjectPublication: false,
          },
        },
        slot,
      })
    ).toThrow(
      "providerCapability.publication.directObjectPublication must be true for direct-public slots"
    );
  });

  test("rejects direct-public slots without manifest-gated publication", () => {
    expect(() =>
      assertProviderCanIssueUploadGrant({
        capability: {
          ...capability,
          publication: {
            ...capability.publication,
            manifestGatedPublication: false,
          },
        },
        slot,
      })
    ).toThrow(
      "providerCapability.publication.manifestGatedPublication must be true for direct object publication"
    );
  });

  test("rejects read-gated slots without read-gate support", () => {
    expect(() =>
      assertProviderCanIssueUploadGrant({
        capability: {
          ...capability,
          publication: {
            ...capability.publication,
            readGateAvailable: false,
          },
        },
        publicationMode: "read-gated",
        slot,
      })
    ).toThrow(
      "providerCapability.publication.readGateAvailable must be true for read-gated slots"
    );
  });

  test("rejects private-promotion slots without promotion support", () => {
    expect(() =>
      assertProviderCanIssueUploadGrant({
        capability: {
          ...capability,
          publication: {
            ...capability.publication,
            privateUploadPublicPromotion: false,
          },
        },
        publicationMode: "private-upload-public-promotion",
        slot,
      })
    ).toThrow(
      "providerCapability.publication.privateUploadPublicPromotion must be true for private-upload-public-promotion slots"
    );
  });
});
