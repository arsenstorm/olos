import type { Commit } from "../types/commit";
import type { ProviderCapabilityDocument } from "../types/provider-capability";
import type { ObjectPublication } from "../types/publication";
import type { PublicationMode } from "../types/upload-slot";
import { assertCommit } from "../validation/commit";
import { assertSafeObjectKey } from "../validation/object-key";
import { assertProviderCapabilityDocument } from "../validation/provider-capability";

export interface CreateObjectPublicationOptions {
  capability: ProviderCapabilityDocument;
  commit: Commit;
  publicationMode?: PublicationMode;
}

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

  assertPublicationModeSupport(capability, publicationMode);

  if (publicationMode !== "direct-public") {
    return commit.deliveryUrl;
  }

  return publicObjectUrl(capability.delivery.publicBaseUrl, commit.objectKey);
}

function assertPublicationModeSupport(
  capability: ProviderCapabilityDocument,
  publicationMode: PublicationMode
): void {
  switch (publicationMode) {
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
      assertUnsupportedPublicationMode(publicationMode);
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
