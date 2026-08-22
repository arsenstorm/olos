import { describe, expect, test } from "bun:test";
import { resolveDirectPublicObjectRequestPolicy } from "../state/direct-public-security-policy";
import type { ProviderCapabilityDocument } from "../types/provider-capability";
import {
  createDirectPublicMediaSecurityPolicy,
  MEDIA_DIRECT_PUBLIC_OBJECT_CONTENT_TYPE,
  MEDIA_DIRECT_PUBLIC_OBJECT_EXTENSIONS,
} from "./direct-public";

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
    contentTypeBound: true,
    exactKey: true,
    methodBound: true,
    objectSizeCanBeObserved: true,
    presignedPut: true,
    requiredHeadersCanBeSigned: true,
  },
};

describe("createDirectPublicMediaSecurityPolicy", () => {
  test("pins the CMAF/LL-HLS extensions and content type", () => {
    const policy = createDirectPublicMediaSecurityPolicy({ capability });

    expect(policy.allowedObjectExtensions).toEqual(
      MEDIA_DIRECT_PUBLIC_OBJECT_EXTENSIONS
    );
    expect(policy.objectContentType).toBe(
      MEDIA_DIRECT_PUBLIC_OBJECT_CONTENT_TYPE
    );
  });

  test("blocks object keys outside the CMAF/LL-HLS extension set", () => {
    const policy = createDirectPublicMediaSecurityPolicy({ capability });

    expect(
      resolveDirectPublicObjectRequestPolicy({
        allowedObjectExtensions: policy.allowedObjectExtensions,
        objectKey: "media/v1080/s3810.ts",
      })
    ).toEqual({
      allowed: false,
      reason: "unsupported-extension",
      status: 404,
    });
  });
});
