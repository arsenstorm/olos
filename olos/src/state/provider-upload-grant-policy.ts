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
  requirePresignedPut?: boolean;
  requireSignedRequiredHeaders?: boolean;
  slot: UploadSlot;
}

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

  if (slot.publicationMode === "direct-public") {
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
    slot.publicationMode === "read-gated" &&
    capability.publication.readGateAvailable !== true
  ) {
    throw new Error(
      "providerCapability.publication.readGateAvailable must be true for read-gated slots"
    );
  }

  if (
    slot.publicationMode === "private-upload-public-promotion" &&
    capability.publication.privateUploadPublicPromotion !== true
  ) {
    throw new Error(
      "providerCapability.publication.privateUploadPublicPromotion must be true for private-upload-public-promotion slots"
    );
  }
}

function assertUploadGrantCapabilities(
  options: ProviderUploadGrantPolicyOptions
): void {
  const uploadGrants = options.capability.uploadGrants;

  if (options.requirePresignedPut !== false && !uploadGrants.presignedPut) {
    throw new Error(
      "providerCapability.uploadGrants.presignedPut must be true"
    );
  }

  if (options.requireExactKey !== false && uploadGrants.exactKey !== true) {
    throw new Error("providerCapability.uploadGrants.exactKey must be true");
  }

  if (
    options.requireMethodBound !== false &&
    uploadGrants.methodBound !== true
  ) {
    throw new Error("providerCapability.uploadGrants.methodBound must be true");
  }

  if (
    options.requireContentTypeBound !== false &&
    uploadGrants.contentTypeBound !== true
  ) {
    throw new Error(
      "providerCapability.uploadGrants.contentTypeBound must be true"
    );
  }

  if (
    options.requireSignedRequiredHeaders !== false &&
    uploadGrants.requiredHeadersCanBeSigned !== true
  ) {
    throw new Error(
      "providerCapability.uploadGrants.requiredHeadersCanBeSigned must be true"
    );
  }

  if (
    options.requireCreateIfAbsent !== false &&
    !options.capability.publication.createIfAbsent
  ) {
    throw new Error(
      "providerCapability.publication.createIfAbsent must be true"
    );
  }

  if (
    options.grantTtlSeconds !== undefined &&
    (!Number.isFinite(options.grantTtlSeconds) || options.grantTtlSeconds <= 0)
  ) {
    throw new Error("grantTtlSeconds must be a positive finite number");
  }

  if (
    options.grantTtlSeconds !== undefined &&
    uploadGrants.maxRecommendedTtlSeconds !== undefined &&
    options.grantTtlSeconds > uploadGrants.maxRecommendedTtlSeconds
  ) {
    throw new Error(
      "grantTtlSeconds must be less than or equal to providerCapability.uploadGrants.maxRecommendedTtlSeconds"
    );
  }
}
