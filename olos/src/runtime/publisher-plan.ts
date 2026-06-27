import { PUBLICATION_MODES } from "../config/publication";
import type { MediaObjectKind } from "../types/media-object";
import type { PublicationMode } from "../types/upload-slot";
import { parseAbsoluteHttpUrl } from "../validation/fields";
import {
  assertUrlSafeIdentifier,
  isNonNegativeInteger,
} from "../validation/ids";
import { assertSupportedMediaExtension } from "../validation/object-key";
import { optionalField } from "./optional-field";
import {
  assertSafePath,
  assertSafePathSegment,
  trimSlashes,
  trimTrailingSlash,
} from "./path";
import { positiveNumber, timestampMs } from "./request-fields";
import type { RuntimeSlotIssuePayload } from "./slot";

const LEADING_DOTS_PATTERN = /^\.+/;

// Publisher plan policies define where runtime-generated object keys and delivery
// URLs are constructed. This is an internal generation boundary, distinct from
// inbound public validation: we normalize prefixes/segments and build safe keys
// from trusted publisher inputs.

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
  publicationMode?: PublicationMode;
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

type InitPublisherObjectPlanOptions =
  CreateRuntimePublisherObjectPlanOptions & {
    kind: "init";
  };
type PartPublisherObjectPlanOptions =
  CreateRuntimePublisherObjectPlanOptions & {
    kind: "part";
  };
type SegmentPublisherObjectPlanOptions =
  CreateRuntimePublisherObjectPlanOptions & {
    kind: "segment";
  };

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
  assertPublicationNoncePolicy(options);

  assertSafePath(options.objectKeyPrefix, "objectKeyPrefix");
  assertSafePathSegment(options.extension, "extension");
  assertSupportedMediaExtension(options.extension, options.kind, "extension");

  assertPlanPartNumber(options);

  if (!isNonNegativeInteger(options.mediaSequenceNumber)) {
    throw new Error("mediaSequenceNumber must be a non-negative integer");
  }

  positiveNumber(options.duration, "duration");

  timestampMs(options.expiresAt, "expiresAt");

  assertPlanByteBounds(options);

  createDeliveryUrl(options.baseUrl, "probe");
}

function assertPlanPartNumber(
  options: CreateRuntimePublisherObjectPlanOptions
): void {
  if (isPartPublisherObjectPlan(options)) {
    if (!isNonNegativeInteger(options.partNumber)) {
      throw new Error("partNumber must be a non-negative integer for parts");
    }
  } else if (options.partNumber !== undefined) {
    throw new Error("partNumber is only valid for parts");
  }
}

function assertPlanByteBounds(
  options: CreateRuntimePublisherObjectPlanOptions
): void {
  positiveNumber(options.maxBytes, "maxBytes");

  if (
    options.minBytes !== undefined &&
    (!isNonNegativeInteger(options.minBytes) ||
      options.minBytes > options.maxBytes)
  ) {
    throw new Error("minBytes must be a non-negative integer up to maxBytes");
  }
}

function assertPublicationMode(value: PublicationMode): void {
  if (!PUBLICATION_MODES.includes(value)) {
    throw new Error(
      `publicationMode must be one of: ${PUBLICATION_MODES.join(", ")}`
    );
  }
}

function assertPublicationNoncePolicy(
  options: CreateRuntimePublisherObjectPlanOptions
): void {
  const publicationMode = options.publicationMode ?? "direct-public";

  assertPublicationMode(publicationMode);

  if (
    publicationMode === "direct-public" &&
    options.objectKeyNonce === undefined
  ) {
    throw new Error(
      "objectKeyNonce is required for direct-public object plans"
    );
  }
}

function createObjectKey(
  options: CreateRuntimePublisherObjectPlanOptions
): string {
  const prefix = trimSlashes(options.objectKeyPrefix);
  const extension = options.extension.replace(LEADING_DOTS_PATTERN, "");

  if (isInitPublisherObjectPlan(options)) {
    return createInitObjectKey(options, prefix, extension);
  }

  if (isSegmentPublisherObjectPlan(options)) {
    return createSegmentObjectKey(options, prefix, extension);
  }

  if (isPartPublisherObjectPlan(options)) {
    return createPartObjectKey(options, prefix, extension);
  }

  throw new Error("unsupported publisher object kind");
}

function createInitObjectKey(
  options: InitPublisherObjectPlanOptions,
  prefix: string,
  extension: string
): string {
  const fileName =
    options.objectKeyNonce === undefined
      ? `init.${extension}`
      : `init-${options.objectKeyNonce}.${extension}`;

  return `${prefix}/${options.renditionId}/${fileName}`;
}

function createSegmentObjectKey(
  options: SegmentPublisherObjectPlanOptions,
  prefix: string,
  extension: string
): string {
  const fileName =
    options.objectKeyNonce === undefined
      ? `s${options.mediaSequenceNumber}.${extension}`
      : `segment-${options.objectKeyNonce}.${extension}`;

  return options.objectKeyNonce === undefined
    ? `${prefix}/${options.renditionId}/${fileName}`
    : `${prefix}/${options.renditionId}/s${options.mediaSequenceNumber}/${fileName}`;
}

function createPartObjectKey(
  options: PartPublisherObjectPlanOptions,
  prefix: string,
  extension: string
): string {
  const fileName =
    options.objectKeyNonce === undefined
      ? `p${options.partNumber}.${extension}`
      : `p${options.partNumber}-${options.objectKeyNonce}.${extension}`;

  return `${prefix}/${options.renditionId}/s${options.mediaSequenceNumber}/${fileName}`;
}

function createObjectId(
  options: CreateRuntimePublisherObjectPlanOptions,
  prefix: string
): string {
  if (isInitPublisherObjectPlan(options)) {
    return `${prefix}_init_${options.renditionId}`;
  }

  if (isSegmentPublisherObjectPlan(options)) {
    return `${prefix}_${options.renditionId}_s${options.mediaSequenceNumber}`;
  }

  return `${prefix}_${options.renditionId}_s${options.mediaSequenceNumber}_p${options.partNumber}`;
}

function isInitPublisherObjectPlan(
  options: CreateRuntimePublisherObjectPlanOptions
): options is InitPublisherObjectPlanOptions {
  return options.kind === "init";
}

function isPartPublisherObjectPlan(
  options: CreateRuntimePublisherObjectPlanOptions
): options is PartPublisherObjectPlanOptions {
  return options.kind === "part";
}

function isSegmentPublisherObjectPlan(
  options: CreateRuntimePublisherObjectPlanOptions
): options is SegmentPublisherObjectPlanOptions {
  return options.kind === "segment";
}

function createDeliveryUrl(baseUrl: string, objectKey: string): string {
  const url = parseAbsoluteHttpUrl(baseUrl, "baseUrl", {
    allowQueryOrFragment: true,
  });

  url.pathname = `${trimTrailingSlash(url.pathname)}/${objectKey}`;
  url.search = "";
  url.hash = "";

  return url.toString();
}

function assertOptionalUrlSafeIdentifier(
  value: string | undefined,
  name: string
): void {
  if (value !== undefined) {
    assertUrlSafeIdentifier(value, name);
  }
}
