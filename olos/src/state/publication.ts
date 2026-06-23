import type { Commit } from "../types/commit";
import type { ProviderCapabilityDocument } from "../types/provider-capability";
import type { ObjectPublication } from "../types/publication";
import { assertCommit } from "../validation/commit";
import { assertSafeObjectKey } from "../validation/object-key";
import { assertProviderCapabilityDocument } from "../validation/provider-capability";

export interface CreateObjectPublicationOptions {
  capability: ProviderCapabilityDocument;
  commit: Commit;
}

export function createObjectPublication(
  options: CreateObjectPublicationOptions
): ObjectPublication {
  assertCommit(options.commit);
  assertProviderCapabilityDocument(options.capability);
  assertProviderOwnsCommit(options);

  return {
    commitId: options.commit.commitId,
    deliveryUrl: deliveryUrlForPublication(options),
    objectKey: options.commit.objectKey,
    providerId: options.commit.providerId,
    publicationMode: options.commit.publicationMode,
    slotId: options.commit.slotId,
  };
}

function deliveryUrlForPublication(
  options: CreateObjectPublicationOptions
): string {
  const { capability, commit } = options;

  assertPublicationModeSupport(capability, commit);

  if (commit.publicationMode !== "direct-public") {
    return commit.deliveryUrl;
  }

  return publicObjectUrl(capability.delivery.publicBaseUrl, commit.objectKey);
}

function assertPublicationModeSupport(
  capability: ProviderCapabilityDocument,
  commit: Commit
): void {
  switch (commit.publicationMode) {
    case "direct-public":
      assertDirectPublicPublicationSupport(capability);
      return;
    case "private-upload-public-promotion":
      assertPrivatePromotionPublicationSupport(capability);
      return;
    case "read-gated":
      assertReadGatedPublicationSupport(capability);
      return;
    default:
      assertUnsupportedPublicationMode(commit.publicationMode);
  }
}

function assertUnsupportedPublicationMode(publicationMode: never): never {
  throw new Error(`unsupported publicationMode ${publicationMode}`);
}

function assertDirectPublicPublicationSupport(
  capability: ProviderCapabilityDocument
): void {
  if (capability.publication.directObjectPublication !== true) {
    throw new Error(
      "providerCapability.publication.directObjectPublication must be true for direct-public commits"
    );
  }

  if (capability.publication.manifestGatedPublication !== true) {
    throw new Error(
      "providerCapability.publication.manifestGatedPublication must be true for direct-public commits"
    );
  }
}

function assertReadGatedPublicationSupport(
  capability: ProviderCapabilityDocument
): void {
  if (capability.publication.readGateAvailable !== true) {
    throw new Error(
      "providerCapability.publication.readGateAvailable must be true for read-gated commits"
    );
  }
}

function assertPrivatePromotionPublicationSupport(
  capability: ProviderCapabilityDocument
): void {
  if (capability.publication.privateUploadPublicPromotion !== true) {
    throw new Error(
      "providerCapability.publication.privateUploadPublicPromotion must be true for private-upload-public-promotion commits"
    );
  }
}

function assertProviderOwnsCommit(
  options: CreateObjectPublicationOptions
): void {
  if (options.commit.providerId !== options.capability.providerId) {
    throw new Error(
      "commit.providerId must match providerCapability.providerId"
    );
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
