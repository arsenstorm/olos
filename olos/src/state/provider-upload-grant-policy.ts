import type { ProviderCapabilityDocument } from "../types/provider-capability";
import type { UploadSlot } from "../types/upload-slot";
import { assertProviderCapabilityDocument } from "../validation/provider-capability";
import { assertUploadSlot } from "../validation/upload-slot";

export interface ProviderUploadGrantPolicyOptions {
  capability: ProviderCapabilityDocument;
  grantTtlSeconds?: number;
  requireContentTypeBound?: boolean;
  requireCreateIfAbsent?: boolean;
  requireExactKey?: boolean;
  requireMethodBound?: boolean;
  requireObjectSizeObservation?: boolean;
  requirePresignedPut?: boolean;
  requireSignedRequiredHeaders?: boolean;
  slot: UploadSlot;
}

type DirectPublicUploadSlot = UploadSlot & { publicationMode: "direct-public" };
type PrivatePromotionUploadSlot = UploadSlot & {
  publicationMode: "private-upload-public-promotion";
};
type ReadGatedUploadSlot = UploadSlot & { publicationMode: "read-gated" };

export function canProviderIssueUploadGrant(
  options: ProviderUploadGrantPolicyOptions
): boolean {
  try {
    assertProviderCanIssueUploadGrant(options);
    return true;
  } catch {
    return false;
  }
}

export function assertProviderCanIssueUploadGrant(
  options: ProviderUploadGrantPolicyOptions
): void {
  assertProviderCapabilityDocument(options.capability);
  assertUploadSlot(options.slot);

  assertProviderMatchesPublicationMode(options);
  assertUploadGrantCapabilities(options);
}

function assertProviderMatchesPublicationMode(
  options: ProviderUploadGrantPolicyOptions
): void {
  const { capability, slot } = options;

  if (isDirectPublicUploadSlot(slot)) {
    if (!capability.publication.directObjectPublication) {
      throw new Error(
        "providerCapability.publication.directObjectPublication must be true for direct-public slots"
      );
    }

    if (capability.publication.manifestGatedPublication !== true) {
      throw new Error(
        "providerCapability.publication.manifestGatedPublication must be true for direct-public slots"
      );
    }

    if (!capability.delivery.negativeCachingPolicyDeclared) {
      throw new Error(
        "providerCapability.delivery.negativeCachingPolicyDeclared must be true for direct-public slots"
      );
    }
  }

  if (
    isReadGatedUploadSlot(slot) &&
    capability.publication.readGateAvailable !== true
  ) {
    throw new Error(
      "providerCapability.publication.readGateAvailable must be true for read-gated slots"
    );
  }

  if (
    isPrivatePromotionUploadSlot(slot) &&
    capability.publication.privateUploadPublicPromotion !== true
  ) {
    throw new Error(
      "providerCapability.publication.privateUploadPublicPromotion must be true for private-upload-public-promotion slots"
    );
  }
}

function isDirectPublicUploadSlot(
  slot: UploadSlot
): slot is DirectPublicUploadSlot {
  return slot.publicationMode === "direct-public";
}

function isPrivatePromotionUploadSlot(
  slot: UploadSlot
): slot is PrivatePromotionUploadSlot {
  return slot.publicationMode === "private-upload-public-promotion";
}

function isReadGatedUploadSlot(slot: UploadSlot): slot is ReadGatedUploadSlot {
  return slot.publicationMode === "read-gated";
}

function assertUploadGrantCapabilities(
  options: ProviderUploadGrantPolicyOptions
): void {
  assertRequiredUploadGrantCapabilities(options);
  assertGrantTtl(options);
}

function assertRequiredUploadGrantCapabilities(
  options: ProviderUploadGrantPolicyOptions
): void {
  const { uploadGrants } = options.capability;

  if (requires(options.requirePresignedPut) && !uploadGrants.presignedPut) {
    throw new Error(
      "providerCapability.uploadGrants.presignedPut must be true"
    );
  }

  if (requires(options.requireExactKey) && uploadGrants.exactKey !== true) {
    throw new Error("providerCapability.uploadGrants.exactKey must be true");
  }

  if (
    requires(options.requireMethodBound) &&
    uploadGrants.methodBound !== true
  ) {
    throw new Error("providerCapability.uploadGrants.methodBound must be true");
  }

  if (
    requires(options.requireContentTypeBound) &&
    uploadGrants.contentTypeBound !== true
  ) {
    throw new Error(
      "providerCapability.uploadGrants.contentTypeBound must be true"
    );
  }

  if (
    requires(options.requireSignedRequiredHeaders) &&
    uploadGrants.requiredHeadersCanBeSigned !== true
  ) {
    throw new Error(
      "providerCapability.uploadGrants.requiredHeadersCanBeSigned must be true"
    );
  }

  if (
    requires(options.requireObjectSizeObservation) &&
    uploadGrants.objectSizeCanBeObserved !== true
  ) {
    throw new Error(
      "providerCapability.uploadGrants.objectSizeCanBeObserved must be true"
    );
  }

  if (
    requires(options.requireCreateIfAbsent) &&
    !options.capability.publication.createIfAbsent
  ) {
    throw new Error(
      "providerCapability.publication.createIfAbsent must be true"
    );
  }
}

function assertGrantTtl(options: ProviderUploadGrantPolicyOptions): void {
  const { grantTtlSeconds } = options;

  if (
    grantTtlSeconds !== undefined &&
    (!Number.isFinite(grantTtlSeconds) || grantTtlSeconds <= 0)
  ) {
    throw new Error("grantTtlSeconds must be a positive finite number");
  }

  assertRecommendedGrantTtl(options);
}

function assertRecommendedGrantTtl(
  options: ProviderUploadGrantPolicyOptions
): void {
  const { grantTtlSeconds } = options;
  const { maxRecommendedTtlSeconds } = options.capability.uploadGrants;

  if (
    grantTtlSeconds !== undefined &&
    maxRecommendedTtlSeconds !== undefined &&
    grantTtlSeconds > maxRecommendedTtlSeconds
  ) {
    throw new Error(
      "grantTtlSeconds must be less than or equal to providerCapability.uploadGrants.maxRecommendedTtlSeconds"
    );
  }
}

function requires(option: boolean | undefined): boolean {
  return option !== false;
}
