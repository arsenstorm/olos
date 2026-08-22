import type { Commit } from "../types/commit";
import type { ProviderCapabilityDocument } from "../types/provider-capability";
import type { ObjectPublication, PublicationMode } from "../types/publication";
import { assertCommit } from "../validation/commit";
import { assertSafeObjectKey } from "../validation/object-key";
import { assertProviderCapabilityDocument } from "../validation/provider-capability";

/** Options for {@link createObjectPublication}. */
export interface CreateObjectPublicationOptions {
  capability: ProviderCapabilityDocument;
  commit: Commit;
  /** Publication mode for the commit (default `direct-public`). */
  publicationMode?: PublicationMode;
}

/**
 * Derive the {@link ObjectPublication} for a commit. In `direct-public`
 * mode (the default) the delivery URL is rebuilt from the provider's
 * `delivery.publicBaseUrl` plus the commit's object key; the other modes
 * keep the commit's own delivery URL. Pure; throws when the capability
 * document does not declare support for the requested publication mode
 * or, in `direct-public` mode, when the object key is unsafe.
 */
export function createObjectPublication(
  options: CreateObjectPublicationOptions
): ObjectPublication {
  assertCommit(options.commit);
  assertProviderCapabilityDocument(options.capability);

  return {
    commitId: options.commit.commitId,
    deliveryUrl: deliveryUrlForPublication(options),
    objectKey: options.commit.objectKey,
    slotId: options.commit.slotId,
  };
}

function deliveryUrlForPublication(
  options: CreateObjectPublicationOptions
): string {
  const { capability, commit } = options;
  const publicationMode = options.publicationMode ?? "direct-public";

  assertPublicationModeCapability(capability, publicationMode, "commits");

  if (publicationMode !== "direct-public") {
    return commit.deliveryUrl;
  }

  return publicObjectUrl(capability.delivery.publicBaseUrl, commit.objectKey);
}

interface CapabilityRequirement {
  flag: (capability: ProviderCapabilityDocument) => boolean | undefined;
  path: string;
}

const PUBLICATION_MODE_REQUIREMENTS: Readonly<
  Record<PublicationMode, readonly CapabilityRequirement[]>
> = {
  "direct-public": [
    {
      flag: (capability) => capability.publication.directObjectPublication,
      path: "publication.directObjectPublication",
    },
    {
      flag: (capability) => capability.publication.manifestGatedPublication,
      path: "publication.manifestGatedPublication",
    },
    {
      flag: (capability) => capability.delivery.negativeCachingPolicyDeclared,
      path: "delivery.negativeCachingPolicyDeclared",
    },
    {
      flag: (capability) => capability.delivery.documentNavigationCanBeBlocked,
      path: "delivery.documentNavigationCanBeBlocked",
    },
    {
      flag: (capability) => capability.delivery.immutableCaching,
      path: "delivery.immutableCaching",
    },
  ],
  "private-upload-public-promotion": [
    {
      flag: (capability) => capability.publication.privateUploadPublicPromotion,
      path: "publication.privateUploadPublicPromotion",
    },
  ],
  "read-gated": [
    {
      flag: (capability) => capability.publication.readGateAvailable,
      path: "publication.readGateAvailable",
    },
  ],
};

/**
 * Assert that the provider declares every capability the publication mode
 * needs. `context` names the operation being gated ("commits", "slots" or
 * "security") and appears in the thrown message.
 */
export function assertPublicationModeCapability(
  capability: ProviderCapabilityDocument,
  publicationMode: PublicationMode,
  context: "commits" | "security" | "slots"
): void {
  for (const requirement of PUBLICATION_MODE_REQUIREMENTS[publicationMode]) {
    if (requirement.flag(capability) !== true) {
      throw new Error(
        `providerCapability.${requirement.path} must be true for ${publicationMode} ${context}`
      );
    }
  }
}

function publicObjectUrl(publicBaseUrl: string, objectKey: string): string {
  assertSafeObjectKey(objectKey, "commit.objectKey");

  const url = new URL(publicBaseUrl);
  const basePath = url.pathname.endsWith("/")
    ? url.pathname.slice(0, -1)
    : url.pathname;
  const keyPath = objectKey
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");

  url.pathname = `${basePath}/${keyPath}`;
  return url.toString();
}
