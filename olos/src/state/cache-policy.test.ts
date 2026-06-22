import { describe, expect, test } from "bun:test";
import type { ProviderCapabilityDocument } from "../types/provider-capability";
import { createDeliveryCachePolicy } from "./cache-policy";

const capability: ProviderCapabilityDocument = {
  consistency: {
    headAfterCreate: "strong",
    readAfterCreate: "strong",
  },
  delivery: {
    immutableCaching: true,
    negativeCachingPolicyDeclared: true,
    publicBaseUrl: "https://media.example.com",
  },
  kind: "object-store",
  olos: "1.0",
  providerId: "provider_1",
  publication: {
    createIfAbsent: true,
    directObjectPublication: true,
    manifestGatedPublication: true,
    overwritesAllowed: false,
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

describe("delivery cache policy", () => {
  test("creates immutable cache policy for media objects", () => {
    expect(
      createDeliveryCachePolicy({
        capability,
        target: "media-object",
      })
    ).toEqual({
      cacheControl: "public, max-age=31536000, immutable",
      maxAgeSeconds: 31_536_000,
      target: "media-object",
    });
  });

  test("rejects media object caching without immutable provider support", () => {
    expect(() =>
      createDeliveryCachePolicy({
        capability: {
          ...capability,
          delivery: {
            ...capability.delivery,
            immutableCaching: false,
          },
        },
        target: "media-object",
      })
    ).toThrow(
      "providerCapability.delivery.immutableCaching must be true for media-object cache policies"
    );
  });

  test("keeps manifest cache freshness within target latency", () => {
    expect(
      createDeliveryCachePolicy({
        maxAgeSeconds: 2,
        target: "manifest",
        targetLatencySeconds: 3,
      })
    ).toEqual({
      cacheControl: "public, max-age=2, must-revalidate",
      maxAgeSeconds: 2,
      target: "manifest",
    });
  });

  test("rejects manifest cache freshness above target latency", () => {
    expect(() =>
      createDeliveryCachePolicy({
        maxAgeSeconds: 5,
        target: "manifest",
        targetLatencySeconds: 3,
      })
    ).toThrow(
      "maxAgeSeconds must be less than or equal to targetLatencySeconds"
    );
  });

  test("rejects non-positive target latency for freshness-bound policies", () => {
    expect(() =>
      createDeliveryCachePolicy({
        target: "manifest",
        targetLatencySeconds: 0,
      })
    ).toThrow("targetLatencySeconds must be a positive integer");
  });

  test("requires declared negative object caching policy", () => {
    expect(() =>
      createDeliveryCachePolicy({
        capability: {
          ...capability,
          delivery: {
            ...capability.delivery,
            negativeCachingPolicyDeclared: false,
          },
          publication: {
            ...capability.publication,
            directObjectPublication: false,
          },
        },
        target: "negative-object",
      })
    ).toThrow(
      "providerCapability.delivery.negativeCachingPolicyDeclared must be true for negative-object cache policies"
    );
  });

  test("creates short negative object cache policy", () => {
    expect(
      createDeliveryCachePolicy({
        capability,
        target: "negative-object",
      })
    ).toEqual({
      cacheControl: "public, max-age=1, must-revalidate",
      maxAgeSeconds: 1,
      target: "negative-object",
    });
  });
});
