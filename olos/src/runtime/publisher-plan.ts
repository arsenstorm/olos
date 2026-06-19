import { PUBLICATION_MODES } from "../config/publication";
import type { MediaObjectKind } from "../types/media-object";
import type { PublicationMode } from "../types/upload-slot";
import { isNonNegativeInteger, isUrlSafeIdentifier } from "../validation/ids";
import { assertSupportedMediaExtension } from "../validation/object-key";
import { optionalField } from "./optional-field";
import { trimSlashes, trimTrailingSlash } from "./path";
import { positiveNumber, timestampMs } from "./request-fields";
import type { RuntimeSlotIssuePayload } from "./slot";

const LEADING_DOTS_PATTERN = /^\.+/;

export interface CreateRuntimePublisherObjectPlanOptions {
  baseUrl: string;
  commitIdPrefix?: string;
  contentType: string;
  duration: number;
  expiresAt: string;
  extension: string;
  kind: RuntimePublisherPlannedObjectKind;
  maxBytes: number;
  mediaSequenceNumber: number;
  minBytes?: number;
  objectKeyNonce?: string;
  objectKeyPrefix: string;
  partNumber?: number;
  publicationMode: PublicationMode;
  publisherInstanceId: string;
  renditionId: string;
  slotIdPrefix?: string;
}

export type RuntimePublisherPlannedObjectKind = Extract<
  MediaObjectKind,
  "init" | "part" | "segment"
>;

export interface RuntimePublisherObjectPlan {
  commitId: string;
  slot: RuntimeSlotIssuePayload;
}

export function createRuntimePublisherObjectPlan(
  options: CreateRuntimePublisherObjectPlanOptions
): RuntimePublisherObjectPlan {
  assertPlanOptions(options);

  const objectKey = createObjectKey(options);
  const slotId = createObjectId(options, options.slotIdPrefix ?? "slot");

  return {
    commitId: createObjectId(options, options.commitIdPrefix ?? "commit"),
    slot: {
      contentType: options.contentType,
      deliveryUrl: createDeliveryUrl(options.baseUrl, objectKey),
      duration: options.duration,
      expiresAt: options.expiresAt,
      kind: options.kind,
      maxBytes: options.maxBytes,
      mediaSequenceNumber: options.mediaSequenceNumber,
      objectKey,
      publicationMode: options.publicationMode,
      publisherInstanceId: options.publisherInstanceId,
      renditionId: options.renditionId,
      slotId,
      ...optionalField("minBytes", options.minBytes),
      ...optionalField("partNumber", options.partNumber),
    },
  };
}

function assertPlanOptions(
  options: CreateRuntimePublisherObjectPlanOptions
): void {
  assertUrlSafeIdentifier(options.renditionId, "renditionId");
  assertUrlSafeIdentifier(options.publisherInstanceId, "publisherInstanceId");
  assertUrlSafeIdentifier(options.slotIdPrefix ?? "slot", "slotIdPrefix");
  assertUrlSafeIdentifier(options.commitIdPrefix ?? "commit", "commitIdPrefix");
  assertOptionalUrlSafeIdentifier(options.objectKeyNonce, "objectKeyNonce");
  assertPublicationMode(options.publicationMode);

  if (
    options.publicationMode === "direct-public" &&
    options.objectKeyNonce === undefined
  ) {
    throw new Error(
      "objectKeyNonce is required for direct-public object plans"
    );
  }

  assertSafePath(options.objectKeyPrefix, "objectKeyPrefix");
  assertSafePathSegment(options.extension, "extension");
  assertSupportedMediaExtension(options.extension, options.kind, "extension");

  if (options.kind === "part") {
    if (!isNonNegativeInteger(options.partNumber)) {
      throw new Error("partNumber must be a non-negative integer for parts");
    }
  } else if (options.partNumber !== undefined) {
    throw new Error("partNumber is only valid for parts");
  }

  if (!isNonNegativeInteger(options.mediaSequenceNumber)) {
    throw new Error("mediaSequenceNumber must be a non-negative integer");
  }

  positiveNumber(options.duration, "duration");

  timestampMs(options.expiresAt, "expiresAt");

  positiveNumber(options.maxBytes, "maxBytes");

  if (
    options.minBytes !== undefined &&
    (!isNonNegativeInteger(options.minBytes) ||
      options.minBytes > options.maxBytes)
  ) {
    throw new Error("minBytes must be a non-negative integer up to maxBytes");
  }

  createDeliveryUrl(options.baseUrl, "probe");
}

function assertPublicationMode(value: PublicationMode): void {
  if (!PUBLICATION_MODES.includes(value)) {
    throw new Error(
      `publicationMode must be one of: ${PUBLICATION_MODES.join(", ")}`
    );
  }
}

function createObjectKey(
  options: CreateRuntimePublisherObjectPlanOptions
): string {
  const prefix = trimSlashes(options.objectKeyPrefix);
  const extension = options.extension.replace(LEADING_DOTS_PATTERN, "");
  const nonce = options.objectKeyNonce;

  if (options.kind === "init") {
    const fileName =
      nonce === undefined ? `init.${extension}` : `init-${nonce}.${extension}`;

    return `${prefix}/${options.renditionId}/${fileName}`;
  }

  if (options.kind === "segment") {
    const fileName =
      nonce === undefined
        ? `s${options.mediaSequenceNumber}.${extension}`
        : `segment-${nonce}.${extension}`;

    return nonce === undefined
      ? `${prefix}/${options.renditionId}/${fileName}`
      : `${prefix}/${options.renditionId}/s${options.mediaSequenceNumber}/${fileName}`;
  }

  const fileName =
    nonce === undefined
      ? `p${options.partNumber}.${extension}`
      : `p${options.partNumber}-${nonce}.${extension}`;

  return `${prefix}/${options.renditionId}/s${options.mediaSequenceNumber}/${fileName}`;
}

function createObjectId(
  options: CreateRuntimePublisherObjectPlanOptions,
  prefix: string
): string {
  if (options.kind === "init") {
    return `${prefix}_init_${options.renditionId}`;
  }

  if (options.kind === "segment") {
    return `${prefix}_${options.renditionId}_s${options.mediaSequenceNumber}`;
  }

  return `${prefix}_${options.renditionId}_s${options.mediaSequenceNumber}_p${options.partNumber}`;
}

function createDeliveryUrl(baseUrl: string, objectKey: string): string {
  const url = baseHttpUrl(baseUrl);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("baseUrl must be an absolute HTTP(S) URL");
  }

  url.pathname = `${trimTrailingSlash(url.pathname)}/${objectKey}`;
  url.search = "";
  url.hash = "";

  return url.toString();
}

function baseHttpUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error("baseUrl must be an absolute HTTP(S) URL");
  }
}

function assertUrlSafeIdentifier(value: string, name: string): void {
  if (!isUrlSafeIdentifier(value)) {
    throw new Error(`${name} must be a non-empty URL-safe identifier`);
  }
}

function assertOptionalUrlSafeIdentifier(
  value: string | undefined,
  name: string
): void {
  if (value !== undefined) {
    assertUrlSafeIdentifier(value, name);
  }
}

function assertSafePath(value: string, name: string): void {
  if (value.includes("?") || value.includes("#")) {
    throw new Error(`${name} must not contain query strings or fragments`);
  }

  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${name} must be a safe relative path`);
  }
}

function assertSafePathSegment(value: string, name: string): void {
  if (
    value.length === 0 ||
    value.includes("/") ||
    value.includes(".") ||
    value === "." ||
    value === ".."
  ) {
    throw new Error(`${name} must be a safe path segment without dots`);
  }
}
