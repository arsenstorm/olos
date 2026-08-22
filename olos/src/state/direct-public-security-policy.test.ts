import { describe, expect, test } from "bun:test";
import type { ProviderCapabilityDocument } from "../types/provider-capability";
import {
  createDirectPublicNegativeObjectResponseHeaders,
  createDirectPublicObjectResponseHeaders,
  createDirectPublicSecurityPolicy,
  resolveDirectPublicObjectRequestPolicy,
} from "./direct-public-security-policy";

const mediaOrigin = "https://media.example.com";

const capability: ProviderCapabilityDocument = {
  consistency: {
    observeAfterCreate: "strong",
    readAfterCreate: "strong",
  },
  delivery: {
    documentNavigationCanBeBlocked: true,
    immutableCaching: true,
    negativeCachingPolicyDeclared: true,
    publicBaseUrl: `${mediaOrigin}/live`,
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

const allowedObjectExtensions = [".m4s", ".mp4"];
const objectContentType = "video/mp4";

describe("direct-public security policy", () => {
  test("creates direct-public delivery security settings", () => {
    expect(
      createDirectPublicSecurityPolicy({
        allowedObjectExtensions,
        capability,
        manifestMaxAgeSeconds: 2,
        objectContentType,
        targetLatencySeconds: 3,
      })
    ).toEqual({
      allowedDeliveryOrigins: [mediaOrigin],
      allowedObjectExtensions: [".m4s", ".mp4"],
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
      objectContentType: "video/mp4",
      objectResponseHeaders: {
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
        allowedObjectExtensions,
        capability: {
          ...capability,
          delivery: {
            ...capability.delivery,
            publicBaseUrl: "http://media.example.com/live",
          },
        },
        objectContentType,
      })
    ).toThrow(
      "providerCapability.delivery.publicBaseUrl must use https for direct-public security"
    );
  });

  test("rejects providers without direct-public publication", () => {
    expect(() =>
      createDirectPublicSecurityPolicy({
        allowedObjectExtensions,
        capability: {
          ...capability,
          publication: {
            ...capability.publication,
            directObjectPublication: false,
          },
        },
        objectContentType,
      })
    ).toThrow(
      "providerCapability.publication.directObjectPublication must be true for direct-public security"
    );
  });

  test("requires manifest-gated direct publication", () => {
    expect(() =>
      createDirectPublicSecurityPolicy({
        allowedObjectExtensions,
        capability: {
          ...capability,
          publication: {
            ...capability.publication,
            manifestGatedPublication: false,
          },
        },
        objectContentType,
      })
    ).toThrow(
      "providerCapability.publication.manifestGatedPublication must be true for direct object publication"
    );
  });

  test("requires document navigation blocking", () => {
    expect(() =>
      createDirectPublicSecurityPolicy({
        allowedObjectExtensions,
        capability: {
          ...capability,
          delivery: {
            ...capability.delivery,
            documentNavigationCanBeBlocked: false,
          },
        },
        objectContentType,
      })
    ).toThrow(
      "providerCapability.delivery.documentNavigationCanBeBlocked must be true for direct-public security"
    );
  });

  test("requires immutable object caching", () => {
    expect(() =>
      createDirectPublicSecurityPolicy({
        allowedObjectExtensions,
        capability: {
          ...capability,
          delivery: {
            ...capability.delivery,
            immutableCaching: false,
          },
        },
        objectContentType,
      })
    ).toThrow(
      "providerCapability.delivery.immutableCaching must be true for direct-public security"
    );
  });

  // The capability document itself already rejects direct object publication
  // without a declared negative-caching policy, so that message wins here.
  test("requires a declared negative-caching policy", () => {
    expect(() =>
      createDirectPublicSecurityPolicy({
        allowedObjectExtensions,
        capability: {
          ...capability,
          delivery: {
            ...capability.delivery,
            negativeCachingPolicyDeclared: false,
          },
        },
        objectContentType,
      })
    ).toThrow(
      "providerCapability.delivery.negativeCachingPolicyDeclared must be true for direct object publication"
    );
  });

  test("keeps manifest cache freshness within target latency", () => {
    expect(() =>
      createDirectPublicSecurityPolicy({
        allowedObjectExtensions,
        capability,
        manifestMaxAgeSeconds: 4,
        objectContentType,
        targetLatencySeconds: 3,
      })
    ).toThrow(
      "maxAgeSeconds must be less than or equal to targetLatencySeconds"
    );
  });

  test("rejects an empty allowed-extension list", () => {
    expect(() =>
      createDirectPublicSecurityPolicy({
        allowedObjectExtensions: [],
        capability,
        objectContentType,
      })
    ).toThrow(
      "allowedObjectExtensions must be a non-empty list of lower-case extensions starting with '.'"
    );
  });

  test("rejects allowed extensions missing the leading dot", () => {
    expect(() =>
      createDirectPublicSecurityPolicy({
        allowedObjectExtensions: ["m4s"],
        capability,
        objectContentType,
      })
    ).toThrow(
      "allowedObjectExtensions must be a non-empty list of lower-case extensions starting with '.'"
    );
  });

  test("rejects upper-case allowed extensions", () => {
    expect(() =>
      createDirectPublicSecurityPolicy({
        allowedObjectExtensions: [".M4S"],
        capability,
        objectContentType,
      })
    ).toThrow(
      "allowedObjectExtensions must be a non-empty list of lower-case extensions starting with '.'"
    );
  });

  test("rejects an invalid object content type", () => {
    expect(() =>
      createDirectPublicSecurityPolicy({
        allowedObjectExtensions,
        capability,
        objectContentType: "not a content type",
      })
    ).toThrow("objectContentType must be a valid content type");
  });

  test("allows supported media object requests", () => {
    expect(
      resolveDirectPublicObjectRequestPolicy({
        accept: "video/*,*/*",
        allowedObjectExtensions,
        objectKey: "media/tenant/session/e1/v1080/s1/p0-slot_1.m4s",
      })
    ).toEqual({ allowed: true });
  });

  test("creates safe media response headers", () => {
    const policy = createDirectPublicSecurityPolicy({
      allowedObjectExtensions,
      capability,
      objectContentType,
    });

    expect(
      createDirectPublicObjectResponseHeaders({
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
    const policy = createDirectPublicSecurityPolicy({
      allowedObjectExtensions,
      capability,
      objectContentType,
    });

    expect(() =>
      createDirectPublicObjectResponseHeaders({
        objectKey: "media/tenant/session/e1/v1080/s1/p0-slot_1.html",
        policy,
      })
    ).toThrow(
      "objectKey is blocked by direct-public policy: unsupported-extension"
    );
  });

  test("creates short negative-object response headers", () => {
    const policy = createDirectPublicSecurityPolicy({
      allowedObjectExtensions,
      capability,
      objectContentType,
    });

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
    const policy = createDirectPublicSecurityPolicy({
      allowedObjectExtensions,
      capability,
      objectContentType,
    });

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
      resolveDirectPublicObjectRequestPolicy({
        allowedObjectExtensions,
        objectKey: "media/tenant/session/e1/v1080/s1/p0-slot_1.html",
      })
    ).toEqual({
      allowed: false,
      reason: "unsupported-extension",
      status: 404,
    });
  });

  test("checks object-key safety before request navigation headers", () => {
    expect(
      resolveDirectPublicObjectRequestPolicy({
        accept: "text/html",
        allowedObjectExtensions,
        fetchMode: "navigate",
        objectKey: "../media/tenant/session/e1/v1080/s1/p0-slot_1.html",
      })
    ).toEqual({
      allowed: false,
      reason: "unsafe-object-key",
      status: 404,
    });
  });

  test("blocks unsafe media object keys", () => {
    for (const objectKey of [
      "../media/tenant/session/e1/v1080/s1/p0-slot_1.m4s",
      "media/tenant/session/e1/v1080/s1/ p0-slot_1.m4s",
    ]) {
      expect(
        resolveDirectPublicObjectRequestPolicy({
          allowedObjectExtensions,
          objectKey,
        })
      ).toEqual({
        allowed: false,
        reason: "unsafe-object-key",
        status: 404,
      });
    }
  });

  test("blocks document navigation to media objects", () => {
    expect(
      resolveDirectPublicObjectRequestPolicy({
        allowedObjectExtensions,
        fetchDestination: "document",
        objectKey: "media/tenant/session/e1/v1080/s1/p0-slot_1.m4s",
      })
    ).toEqual({
      allowed: false,
      reason: "document-navigation",
      status: 403,
    });
  });

  test("blocks navigate-mode requests to media objects", () => {
    expect(
      resolveDirectPublicObjectRequestPolicy({
        allowedObjectExtensions,
        fetchMode: "navigate",
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
      resolveDirectPublicObjectRequestPolicy({
        accept: "text/html,application/xhtml+xml",
        allowedObjectExtensions,
        objectKey: "media/tenant/session/e1/v1080/s1/p0-slot_1.mp4",
      })
    ).toEqual({
      allowed: false,
      reason: "html-accept",
      status: 403,
    });
  });
});
