import { describe, expect, test } from "bun:test";
import type { ProviderCapabilityDocument } from "../types/provider-capability";
import {
  createDirectPublicMediaResponseHeaders,
  createDirectPublicNegativeObjectResponseHeaders,
  createDirectPublicSecurityPolicy,
  resolveDirectPublicMediaRequestPolicy,
} from "./direct-public-security-policy";

const capability: ProviderCapabilityDocument = {
  consistency: {
    headAfterCreate: "strong",
    readAfterCreate: "strong",
  },
  delivery: {
    documentNavigationCanBeBlocked: true,
    immutableCaching: true,
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
  },
  uploadGrants: {
    presignedPut: true,
  },
};

describe("direct-public security policy", () => {
  test("creates direct-public delivery security settings", () => {
    expect(
      createDirectPublicSecurityPolicy({
        capability,
        manifestMaxAgeSeconds: 2,
        targetLatencySeconds: 3,
      })
    ).toEqual({
      allowedMediaOrigins: ["https://media.example.com"],
      allowedMediaExtensions: [".m4s", ".mp4"],
      forbiddenResponseHeaders: ["set-cookie"],
      manifestCachePolicy: {
        cacheControl: "public, max-age=2, must-revalidate",
        maxAgeSeconds: 2,
        target: "manifest",
      },
      mediaObjectCachePolicy: {
        cacheControl: "public, max-age=31536000, immutable",
        maxAgeSeconds: 31_536_000,
        target: "media-object",
      },
      mediaResponseHeaders: {
        "access-control-allow-credentials": "false",
        "cross-origin-resource-policy": "same-site",
        "x-content-type-options": "nosniff",
      },
      negativeObjectCachePolicy: {
        cacheControl: "public, max-age=1, must-revalidate",
        maxAgeSeconds: 1,
        target: "negative-object",
      },
    });
  });

  test("rejects non-HTTPS public object origins", () => {
    expect(() =>
      createDirectPublicSecurityPolicy({
        capability: {
          ...capability,
          delivery: {
            ...capability.delivery,
            publicBaseUrl: "http://media.example.com/live",
          },
        },
      })
    ).toThrow(
      "providerCapability.delivery.publicBaseUrl must use https for direct-public security"
    );
  });

  test("rejects providers without direct-public publication", () => {
    expect(() =>
      createDirectPublicSecurityPolicy({
        capability: {
          ...capability,
          publication: {
            ...capability.publication,
            directObjectPublication: false,
          },
        },
      })
    ).toThrow(
      "providerCapability.publication.directObjectPublication must be true for direct-public security"
    );
  });

  test("requires manifest-gated direct publication", () => {
    expect(() =>
      createDirectPublicSecurityPolicy({
        capability: {
          ...capability,
          publication: {
            ...capability.publication,
            manifestGatedPublication: false,
          },
        },
      })
    ).toThrow(
      "providerCapability.publication.manifestGatedPublication must be true for direct-public security"
    );
  });

  test("requires document navigation blocking", () => {
    expect(() =>
      createDirectPublicSecurityPolicy({
        capability: {
          ...capability,
          delivery: {
            ...capability.delivery,
            documentNavigationCanBeBlocked: false,
          },
        },
      })
    ).toThrow(
      "providerCapability.delivery.documentNavigationCanBeBlocked must be true for direct-public security"
    );
  });

  test("requires immutable object caching", () => {
    expect(() =>
      createDirectPublicSecurityPolicy({
        capability: {
          ...capability,
          delivery: {
            ...capability.delivery,
            immutableCaching: false,
          },
        },
      })
    ).toThrow(
      "providerCapability.delivery.immutableCaching must be true for media-object cache policies"
    );
  });

  test("keeps manifest cache freshness within target latency", () => {
    expect(() =>
      createDirectPublicSecurityPolicy({
        capability,
        manifestMaxAgeSeconds: 4,
        targetLatencySeconds: 3,
      })
    ).toThrow(
      "maxAgeSeconds must be less than or equal to targetLatencySeconds"
    );
  });

  test("allows supported media object requests", () => {
    expect(
      resolveDirectPublicMediaRequestPolicy({
        accept: "video/*,*/*",
        objectKey: "media/tenant/session/e1/v1080/s1/p0-slot_1.m4s",
      })
    ).toEqual({ allowed: true });
  });

  test("creates safe media response headers", () => {
    const policy = createDirectPublicSecurityPolicy({ capability });

    expect(
      createDirectPublicMediaResponseHeaders({
        objectKey: "media/tenant/session/e1/v1080/s1/p0-slot_1.m4s",
        policy,
      })
    ).toEqual({
      "access-control-allow-credentials": "false",
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": "video/mp4",
      "cross-origin-resource-policy": "same-site",
      "x-content-type-options": "nosniff",
    });
  });

  test("rejects response headers for unknown media extensions", () => {
    const policy = createDirectPublicSecurityPolicy({ capability });

    expect(() =>
      createDirectPublicMediaResponseHeaders({
        objectKey: "media/tenant/session/e1/v1080/s1/p0-slot_1.html",
        policy,
      })
    ).toThrow(
      "objectKey is blocked by direct-public policy: unsupported-extension"
    );
  });

  test("creates short negative-object response headers", () => {
    const policy = createDirectPublicSecurityPolicy({ capability });

    expect(
      createDirectPublicNegativeObjectResponseHeaders({
        objectKey: "media/tenant/session/e1/v1080/s1/p0-slot_1.m4s",
        policy,
      })
    ).toEqual({
      "access-control-allow-credentials": "false",
      "cache-control": "public, max-age=1, must-revalidate",
      "cross-origin-resource-policy": "same-site",
      "x-content-type-options": "nosniff",
    });
  });

  test("rejects negative response headers for unknown media extensions", () => {
    const policy = createDirectPublicSecurityPolicy({ capability });

    expect(() =>
      createDirectPublicNegativeObjectResponseHeaders({
        objectKey: "media/tenant/session/e1/v1080/s1/p0-slot_1.txt",
        policy,
      })
    ).toThrow(
      "objectKey is blocked by direct-public policy: unsupported-extension"
    );
  });

  test("blocks unknown media object extensions", () => {
    expect(
      resolveDirectPublicMediaRequestPolicy({
        objectKey: "media/tenant/session/e1/v1080/s1/p0-slot_1.html",
      })
    ).toEqual({
      allowed: false,
      reason: "unsupported-extension",
      status: 404,
    });
  });

  test("blocks document navigation to media objects", () => {
    expect(
      resolveDirectPublicMediaRequestPolicy({
        fetchDestination: "document",
        objectKey: "media/tenant/session/e1/v1080/s1/p0-slot_1.m4s",
      })
    ).toEqual({
      allowed: false,
      reason: "document-navigation",
      status: 403,
    });
  });

  test("blocks HTML accept requests for media objects", () => {
    expect(
      resolveDirectPublicMediaRequestPolicy({
        accept: "text/html,application/xhtml+xml",
        objectKey: "media/tenant/session/e1/v1080/s1/p0-slot_1.mp4",
      })
    ).toEqual({
      allowed: false,
      reason: "html-accept",
      status: 403,
    });
  });
});
