import { OLOS_WIRE_VERSION } from "../protocol";
import type { OlosId } from "../types/ids";
import type {
  ProviderCapabilityDocument,
  ProviderEventDeliveryMode,
} from "../types/provider-capability";
import { assertProviderCapabilityDocument } from "../validation/provider-capability";

export const S3_UPLOAD_GRANT_REQUIRED_HEADERS = [
  "Content-Type",
  "If-None-Match",
  "x-olos-slot-id",
] as const;

export interface CreateS3ProviderCapabilityOptions {
  eventDelivery?: ProviderEventDeliveryMode;
  maxRecommendedTtlSeconds?: number;
  objectCreatedEvents?: boolean;
  privateUploadPublicPromotion?: boolean;
  providerId: OlosId;
  publicBaseUrl: string;
  readGateAvailable?: boolean;
}

export function createS3ProviderCapability(
  options: CreateS3ProviderCapabilityOptions
): ProviderCapabilityDocument {
  const objectCreatedEvents = options.objectCreatedEvents ?? true;
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
      publicBaseUrl: options.publicBaseUrl,
      rangeRequests: true,
    },
    events: {
      delivery: options.eventDelivery ?? "at-least-once",
      objectCreated: objectCreatedEvents,
    },
    kind: "object-store",
    olos: OLOS_WIRE_VERSION,
    providerId: options.providerId,
    publication: {
      createIfAbsent: true,
      directObjectPublication: true,
      manifestGatedPublication: true,
      overwritesAllowed: false,
      privateUploadPublicPromotion:
        options.privateUploadPublicPromotion ?? true,
      readGateAvailable: options.readGateAvailable ?? false,
    },
    uploadGrants: {
      contentTypeBound: true,
      exactKey: true,
      maxRecommendedTtlSeconds: options.maxRecommendedTtlSeconds ?? 60,
      methodBound: true,
      presignedPut: true,
      requiredHeadersCanBeSigned: true,
      temporaryCredentials: true,
    },
  };

  assertProviderCapabilityDocument(capability);
  return capability;
}
