import type { ProviderCapabilityDocument } from "../types/provider-capability";
import type { PublicationMode } from "../types/publication";
import type { UploadSlot } from "../types/upload-slot";
import { assertProviderCapabilityDocument } from "../validation/provider-capability";
import { assertUploadSlot } from "../validation/upload-slot";

/**
 * Options for {@link canProviderIssueUploadGrant} and
 * {@link assertProviderCanIssueUploadGrant}. Every `require*` flag
 * defaults to true; set one to `false` to waive that capability check.
 */
export interface ProviderUploadGrantPolicyOptions {
  capability: ProviderCapabilityDocument;
  /**
   * Requested grant TTL in seconds. Must be a positive finite number and
   * must not exceed the provider's
   * `uploadGrants.maxRecommendedTtlSeconds` when declared.
   */
  grantTtlSeconds?: number;
  /** Publication mode the slot will use (default `direct-public`). */
  publicationMode?: PublicationMode;
  requireContentTypeBound?: boolean;
  requireCreateIfAbsent?: boolean;
  requireExactKey?: boolean;
  requireMethodBound?: boolean;
  requireObjectSizeObservation?: boolean;
  requirePresignedPut?: boolean;
  requireSignedRequiredHeaders?: boolean;
  slot: UploadSlot;
}

type UploadGrantCapabilityOption =
  | "requireContentTypeBound"
  | "requireCreateIfAbsent"
  | "requireExactKey"
  | "requireMethodBound"
  | "requireObjectSizeObservation"
  | "requirePresignedPut"
  | "requireSignedRequiredHeaders";

interface UploadGrantCapabilityRequirement {
  isSupported: (options: ProviderUploadGrantPolicyOptions) => boolean;
  message: string;
  option: UploadGrantCapabilityOption;
}

const UPLOAD_GRANT_CAPABILITY_REQUIREMENTS = [
  {
    isSupported: (options) =>
      options.capability.uploadGrants.presignedPut === true,
    message: "providerCapability.uploadGrants.presignedPut must be true",
    option: "requirePresignedPut",
  },
  {
    isSupported: (options) => options.capability.uploadGrants.exactKey === true,
    message: "providerCapability.uploadGrants.exactKey must be true",
    option: "requireExactKey",
  },
  {
    isSupported: (options) =>
      options.capability.uploadGrants.methodBound === true,
    message: "providerCapability.uploadGrants.methodBound must be true",
    option: "requireMethodBound",
  },
  {
    isSupported: (options) =>
      options.capability.uploadGrants.contentTypeBound === true,
    message: "providerCapability.uploadGrants.contentTypeBound must be true",
    option: "requireContentTypeBound",
  },
  {
    isSupported: (options) =>
      options.capability.uploadGrants.requiredHeadersCanBeSigned === true,
    message:
      "providerCapability.uploadGrants.requiredHeadersCanBeSigned must be true",
    option: "requireSignedRequiredHeaders",
  },
  {
    isSupported: (options) =>
      options.capability.uploadGrants.objectSizeCanBeObserved === true,
    message:
      "providerCapability.uploadGrants.objectSizeCanBeObserved must be true",
    option: "requireObjectSizeObservation",
  },
  {
    isSupported: (options) =>
      options.capability.publication.createIfAbsent === true,
    message: "providerCapability.publication.createIfAbsent must be true",
    option: "requireCreateIfAbsent",
  },
] satisfies readonly UploadGrantCapabilityRequirement[];

/**
 * Non-throwing variant of {@link assertProviderCanIssueUploadGrant}:
 * whether the provider's capability document permits issuing an upload
 * grant for the slot under the given policy. Pure.
 */
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

/**
 * Assert that a provider's capability document permits issuing an upload
 * grant for the slot. Checks publication-mode support (`direct-public`
 * additionally requires manifest-gated publication and a declared
 * negative-caching policy), each upload-grant capability required by the
 * non-waived `require*` flags, and the grant TTL bounds. Throws an
 * `Error` naming the first failed requirement.
 */
export function assertProviderCanIssueUploadGrant(
  options: ProviderUploadGrantPolicyOptions
): void {
  assertProviderCapabilityDocument(options.capability);
  assertUploadSlot(options.slot);

  assertProviderMatchesPublicationMode(options);
  assertUploadGrantCapabilities(options);
}

/** Direct-public slots are readable the moment they are written, so the
 * provider must publish directly, gate visibility on the manifest, declare
 * a negative-caching policy, be able to block document navigation to the
 * object, and cache it immutably. */
function assertDirectPublicCapability(
  capability: ProviderUploadGrantPolicyOptions["capability"]
): void {
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

  if (!capability.delivery.documentNavigationCanBeBlocked) {
    throw new Error(
      "providerCapability.delivery.documentNavigationCanBeBlocked must be true for direct-public slots"
    );
  }

  if (!capability.delivery.immutableCaching) {
    throw new Error(
      "providerCapability.delivery.immutableCaching must be true for direct-public slots"
    );
  }
}

function assertProviderMatchesPublicationMode(
  options: ProviderUploadGrantPolicyOptions
): void {
  const { capability } = options;
  const publicationMode = options.publicationMode ?? "direct-public";

  if (publicationMode === "direct-public") {
    assertDirectPublicCapability(capability);
  }

  if (
    publicationMode === "read-gated" &&
    capability.publication.readGateAvailable !== true
  ) {
    throw new Error(
      "providerCapability.publication.readGateAvailable must be true for read-gated slots"
    );
  }

  if (
    publicationMode === "private-upload-public-promotion" &&
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
  assertRequiredUploadGrantCapabilities(options);
  assertGrantTtl(options);
}

function assertRequiredUploadGrantCapabilities(
  options: ProviderUploadGrantPolicyOptions
): void {
  for (const requirement of UPLOAD_GRANT_CAPABILITY_REQUIREMENTS) {
    assertUploadGrantCapabilityRequirement(options, requirement);
  }
}

function assertUploadGrantCapabilityRequirement(
  options: ProviderUploadGrantPolicyOptions,
  requirement: UploadGrantCapabilityRequirement
): void {
  if (
    requires(options[requirement.option]) &&
    !requirement.isSupported(options)
  ) {
    throw new Error(requirement.message);
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
