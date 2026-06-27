import { PUBLICATION_MODES } from "../config/publication";
import {
  createPublisherDeliveryUrl,
  createPublisherObjectKey,
} from "../state/object-key-derivation";
import type { MediaObjectKind } from "../types/media-object";
import type { PublicationMode } from "../types/upload-slot";
import {
  assertUrlSafeIdentifier,
  isNonNegativeInteger,
} from "../validation/ids";
import { assertSupportedMediaExtension } from "../validation/object-key";
import { optionalField } from "./optional-field";
import { assertSafePath, assertSafePathSegment } from "./path";
import { positiveNumber, timestampMs } from "./request-fields";
import type { RuntimeSlotIssuePayload } from "./slot";

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

  const objectKey = createPublisherObjectKey(options);
  const slotId = createObjectId(options, options.slotIdPrefix ?? "slot");

  return {
    commitId: createObjectId(options, options.commitIdPrefix ?? "commit"),
    slot: {
      contentType: options.contentType,
      deliveryUrl: createPublisherDeliveryUrl(options.baseUrl, objectKey),
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

  createPublisherDeliveryUrl(options.baseUrl, "probe");
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

function assertOptionalUrlSafeIdentifier(
  value: string | undefined,
  name: string
): void {
  if (value !== undefined) {
    assertUrlSafeIdentifier(value, name);
  }
}
