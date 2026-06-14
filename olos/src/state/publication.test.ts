import { describe, expect, test } from "bun:test";
import type { Commit } from "../types/commit";
import type { ProviderCapabilityDocument } from "../types/provider-capability";
import { createObjectPublication } from "./publication";

const capability: ProviderCapabilityDocument = {
  api: {
    family: "s3-compatible",
  },
  consistency: {
    headAfterCreate: "strong",
    readAfterCreate: "strong",
  },
  delivery: {
    negativeCachingPolicyDeclared: true,
    publicBaseUrl: "https://media.example.com/live",
  },
  kind: "object-store",
  olos: "1.0",
  providerId: "provider_1",
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
    methodBound: true,
    objectSizeCanBeObserved: true,
    presignedPut: true,
    requiredHeadersCanBeSigned: true,
  },
};

const commit: Commit = {
  commitId: "commit_1",
  committedAt: "2026-01-01T00:00:02.000Z",
  deliveryUrl: "/objects/tenant/session/v1080/3810.m4s",
  duration: 2,
  epoch: 0,
  mediaSequenceNumber: 3810,
  objectKey: "tenant/session/v1080/3810.m4s",
  providerId: "provider_1",
  publicationMode: "direct-public",
  renditionId: "v1080",
  sessionId: "session_1",
  size: 10_000,
  slotId: "slot_1",
};

describe("object publication", () => {
  test("creates direct-public publication references from the provider public base URL", () => {
    expect(createObjectPublication({ capability, commit })).toEqual({
      commitId: "commit_1",
      deliveryUrl:
        "https://media.example.com/live/tenant/session/v1080/3810.m4s",
      objectKey: "tenant/session/v1080/3810.m4s",
      providerId: "provider_1",
      publicationMode: "direct-public",
      slotId: "slot_1",
    });
  });

  test("rejects publication through a different provider", () => {
    expect(() =>
      createObjectPublication({
        capability: {
          ...capability,
          providerId: "provider_2",
        },
        commit,
      })
    ).toThrow("commit.providerId must match providerCapability.providerId");
  });

  test("rejects direct-public commits when the provider cannot publish direct objects", () => {
    expect(() =>
      createObjectPublication({
        capability: {
          ...capability,
          publication: {
            ...capability.publication,
            directObjectPublication: false,
          },
        },
        commit,
      })
    ).toThrow(
      "providerCapability.publication.directObjectPublication must be true for direct-public commits"
    );
  });

  test("rejects unsafe direct-public object keys", () => {
    const unsafeKeys = [
      "/tenant/session/v1080/3810.m4s",
      "tenant//session/v1080/3810.m4s",
      "tenant/../session/v1080/3810.m4s",
      "tenant/session/v1080/3810.m4s\n",
    ];

    for (const objectKey of unsafeKeys) {
      expect(() =>
        createObjectPublication({
          capability,
          commit: {
            ...commit,
            objectKey,
          },
        })
      ).toThrow("commit.objectKey");
    }
  });

  test("keeps committed read-gated delivery URLs behind providers with read gates", () => {
    expect(
      createObjectPublication({
        capability,
        commit: {
          ...commit,
          deliveryUrl: "/gate/session/v1080/3810.m4s",
          publicationMode: "read-gated",
        },
      }).deliveryUrl
    ).toBe("/gate/session/v1080/3810.m4s");
  });

  test("rejects read-gated commits when the provider has no read gate", () => {
    expect(() =>
      createObjectPublication({
        capability: {
          ...capability,
          publication: {
            ...capability.publication,
            readGateAvailable: false,
          },
        },
        commit: {
          ...commit,
          publicationMode: "read-gated",
        },
      })
    ).toThrow(
      "providerCapability.publication.readGateAvailable must be true for read-gated commits"
    );
  });
});
