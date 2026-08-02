import type {
  CommittedObject,
  CommittedPart,
  CommittedSegment,
  CommittedWindow,
} from "../types/committed-window";
import { assertByterange, BYTERANGE_FIELDS } from "./byterange";
import { assertSafeDeliveryUrl } from "./delivery-url";
import {
  assertBooleanField,
  assertIsoDateField,
  assertNonEmptyStringField,
  assertNonNegativeIntegerField,
  assertOnlyKnownFields,
  assertPositiveNumberField,
  assertUrlSafeField,
  isRecord,
  type KnownFieldsShape,
  nonEmptyArray,
} from "./fields";
import { assertSafeObjectKey } from "./object-key";

const COMMITTED_WINDOW_FIELDS = [
  "discontinuitySequence",
  "epoch",
  "firstMediaSequenceNumber",
  "lastMediaSequenceNumber",
  "renditions",
] as const;

const RENDITION_WINDOW_FIELDS = [
  "discontinuitySequence",
  "init",
  "renditionId",
  "segments",
] as const;

const COMMITTED_SEGMENT_FIELDS = [
  "discontinuityBefore",
  "duration",
  "independent",
  "mediaSequenceNumber",
  "parts",
  "programDateTime",
  "segment",
] as const;

const COMMITTED_OBJECT_FIELDS = [
  "commitId",
  "contentType",
  "deliveryUrl",
  "duration",
  "etag",
  "objectKey",
  "slotId",
] as const;

const COMMITTED_PART_FIELDS = [
  ...COMMITTED_OBJECT_FIELDS,
  "byterange",
  "independent",
  "partNumber",
  "programDateTime",
] as const;

const COMMITTED_OBJECT_SHAPE: KnownFieldsShape = {
  fields: COMMITTED_OBJECT_FIELDS,
};

const COMMITTED_PART_SHAPE: KnownFieldsShape = {
  fields: COMMITTED_PART_FIELDS,
  nested: {
    byterange: { kind: "object", shape: { fields: BYTERANGE_FIELDS } },
  },
};

const COMMITTED_SEGMENT_SHAPE: KnownFieldsShape = {
  fields: COMMITTED_SEGMENT_FIELDS,
  nested: {
    parts: { kind: "array", shape: COMMITTED_PART_SHAPE },
    segment: { kind: "object", shape: COMMITTED_OBJECT_SHAPE },
  },
};

const RENDITION_WINDOW_SHAPE: KnownFieldsShape = {
  fields: RENDITION_WINDOW_FIELDS,
  nested: {
    init: { kind: "object", shape: COMMITTED_OBJECT_SHAPE },
    segments: { kind: "array", shape: COMMITTED_SEGMENT_SHAPE },
  },
};

/**
 * `KnownFieldsShape` of a wire-format `CommittedWindow`, for tolerant
 * read-path pruning with `pruneUnknownFields` — renditions is a map of
 * rendition windows, each with committed objects, segments, and parts.
 */
export const COMMITTED_WINDOW_SHAPE: KnownFieldsShape = {
  fields: COMMITTED_WINDOW_FIELDS,
  nested: {
    renditions: { kind: "map", shape: RENDITION_WINDOW_SHAPE },
  },
};

interface CommittedPartPositionTracker {
  previousPart: number;
  seenParts: Map<number, string>;
}

interface CommittedSegmentPositionTracker {
  previousSequence: number;
  seenSegments: Set<number>;
}

/**
 * Returns the highest part number on the visible window's last segment
 * across all renditions, or undefined when the last segment is a full
 * segment (no parts) or no segments exist.
 */
export function lastVisiblePartNumber(
  window: CommittedWindow
): number | undefined {
  let max: number | undefined;

  for (const rendition of Object.values(window.renditions)) {
    const lastSegment = rendition.segments.at(-1);

    if (lastSegment?.mediaSequenceNumber !== window.lastMediaSequenceNumber) {
      continue;
    }

    const lastPart = lastSegment.parts?.at(-1);

    if (lastPart === undefined) {
      continue;
    }

    if (max === undefined || lastPart.partNumber > max) {
      max = lastPart.partNumber;
    }
  }

  return max;
}

/**
 * Returns whether `value` is a valid `CommittedWindow` (see
 * `assertCommittedWindow`).
 */
export function isCommittedWindow(value: unknown): value is CommittedWindow {
  try {
    assertCommittedWindow(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates an untrusted value as a `CommittedWindow`, throwing an `Error`
 * naming the first offending field. Rejects unknown fields at every level.
 * Beyond field shapes, it enforces the structural invariants manifests rely
 * on: non-empty renditions whose keys match their `renditionId`, monotonic
 * and duplicate-free media sequence numbers and part numbers, and a segment
 * or parts on every position.
 */
export function assertCommittedWindow(
  value: unknown
): asserts value is CommittedWindow {
  if (!isRecord(value)) {
    throw new Error("committedWindow must be an object");
  }

  assertOnlyKnownFields(value, COMMITTED_WINDOW_FIELDS, "committedWindow");
  assertNonNegativeIntegerField(value, "epoch", "committedWindow");
  assertNonNegativeIntegerField(
    value,
    "discontinuitySequence",
    "committedWindow"
  );
  assertNonNegativeIntegerField(
    value,
    "firstMediaSequenceNumber",
    "committedWindow"
  );
  assertNonNegativeIntegerField(
    value,
    "lastMediaSequenceNumber",
    "committedWindow"
  );
  assertCommittedWindowSequence(value);

  if (
    !isRecord(value.renditions) ||
    Object.keys(value.renditions).length === 0
  ) {
    throw new Error("committedWindow.renditions must be a non-empty object");
  }

  for (const [renditionId, rendition] of Object.entries(value.renditions)) {
    assertRenditionWindow(rendition, renditionId);
  }
}

function assertCommittedWindowSequence(value: Record<string, unknown>): void {
  if (
    Number(value.firstMediaSequenceNumber) >
    Number(value.lastMediaSequenceNumber)
  ) {
    throw new Error(
      "committedWindow.firstMediaSequenceNumber must be less than or equal to lastMediaSequenceNumber"
    );
  }
}

function assertRenditionWindow(value: unknown, key: string): void {
  const name = `committedWindow.renditions.${key}`;

  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }

  assertOnlyKnownFields(value, RENDITION_WINDOW_FIELDS, name);
  assertUrlSafeField(value, "renditionId", name);

  if (value.renditionId !== key) {
    throw new Error(`${name}.renditionId must match its renditions key`);
  }

  if (value.discontinuitySequence !== undefined) {
    assertNonNegativeIntegerField(value, "discontinuitySequence", name);
  }

  assertCommittedObject(value.init, `${name}.init`);

  assertMonotonicSegments(
    nonEmptyArray<CommittedSegment>(value.segments, `${name}.segments`),
    name
  );
}

function assertMonotonicSegments(
  segments: readonly unknown[],
  name: string
): void {
  const positions = initialCommittedSegmentPositionTracker();

  for (const segment of segments) {
    assertCommittedSegment(segment, name);
    assertOrderedUniqueSegmentPosition(segment, positions, name);
  }
}

function initialCommittedSegmentPositionTracker(): CommittedSegmentPositionTracker {
  return {
    previousSequence: -1,
    seenSegments: new Set<number>(),
  };
}

function assertOrderedUniqueSegmentPosition(
  segment: CommittedSegment,
  positions: CommittedSegmentPositionTracker,
  name: string
): void {
  assertUniqueSegmentPosition(segment, positions.seenSegments, name);
  assertMonotonicSegmentSequence(segment, positions.previousSequence, name);

  positions.seenSegments.add(segment.mediaSequenceNumber);
  positions.previousSequence = segment.mediaSequenceNumber;
}

function assertUniqueSegmentPosition(
  segment: CommittedSegment,
  seenSegments: Set<number>,
  name: string
): void {
  if (seenSegments.has(segment.mediaSequenceNumber)) {
    throw new Error(`${name}.segments must not contain duplicate positions`);
  }
}

function assertMonotonicSegmentSequence(
  segment: CommittedSegment,
  previousSequence: number,
  name: string
): void {
  if (segment.mediaSequenceNumber <= previousSequence) {
    throw new Error(`${name}.segments must have monotonic media sequences`);
  }
}

function assertCommittedSegment(
  value: unknown,
  renditionName: string
): asserts value is CommittedSegment {
  const name = `${renditionName}.segments[]`;

  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }

  assertOnlyKnownFields(value, COMMITTED_SEGMENT_FIELDS, name);
  assertNonNegativeIntegerField(value, "mediaSequenceNumber", name);
  assertPositiveNumberField(value, "duration", name);
  assertOptionalSegmentFields(value, name);
  assertCommittedSegmentPayload(value, name);
}

function assertCommittedSegmentPayload(
  value: Record<string, unknown>,
  name: string
): void {
  if (value.segment !== undefined) {
    assertCommittedObject(value.segment, `${name}.segment`);
  }

  if (value.parts !== undefined) {
    assertCommittedParts(value.parts, name);
  }

  if (value.segment === undefined && value.parts === undefined) {
    throw new Error(`${name} must contain a segment or parts`);
  }
}

function assertOptionalSegmentFields(
  value: Record<string, unknown>,
  name: string
): void {
  if (value.programDateTime !== undefined) {
    assertIsoDateField(value, "programDateTime", name);
  }

  if (value.discontinuityBefore !== undefined) {
    assertBooleanField(value, "discontinuityBefore", name);
  }

  if (value.independent !== undefined) {
    assertBooleanField(value, "independent", name);
  }
}

function assertCommittedParts(value: unknown, segmentName: string): void {
  const parts = nonEmptyArray<CommittedPart>(value, `${segmentName}.parts`);
  const positions = initialCommittedPartPositionTracker();

  for (const part of parts) {
    assertCommittedPart(part, segmentName);
    assertOrderedUniquePartPosition(part, positions, segmentName);
  }
}

function initialCommittedPartPositionTracker(): CommittedPartPositionTracker {
  return {
    previousPart: -1,
    seenParts: new Map<number, string>(),
  };
}

function assertOrderedUniquePartPosition(
  part: CommittedPart,
  positions: CommittedPartPositionTracker,
  segmentName: string
): void {
  assertUniquePartPosition(part, positions.seenParts, segmentName);
  assertMonotonicPartNumber(part, positions.previousPart, segmentName);

  positions.seenParts.set(part.partNumber, part.deliveryUrl);
  positions.previousPart = part.partNumber;
}

function assertUniquePartPosition(
  part: CommittedPart,
  seenParts: ReadonlyMap<number, string>,
  segmentName: string
): void {
  const existingUrl = seenParts.get(part.partNumber);

  if (existingUrl !== undefined && existingUrl !== part.deliveryUrl) {
    throw new Error(
      `${segmentName}.parts must not contain duplicate positions with different URLs`
    );
  }

  if (existingUrl !== undefined) {
    throw new Error(
      `${segmentName}.parts must not contain duplicate positions`
    );
  }
}

function assertMonotonicPartNumber(
  part: CommittedPart,
  previousPart: number,
  segmentName: string
): void {
  if (part.partNumber <= previousPart) {
    throw new Error(`${segmentName}.parts must have monotonic part numbers`);
  }
}

function assertCommittedPart(
  value: unknown,
  segmentName: string
): asserts value is CommittedPart {
  const name = `${segmentName}.parts[]`;

  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }

  assertCommittedObject(value, name, COMMITTED_PART_FIELDS);

  assertNonNegativeIntegerField(value, "partNumber", name);
  assertPositiveNumberField(value, "duration", name);
  assertOptionalPartFields(value, name);
}

function assertOptionalPartFields(
  value: Record<string, unknown>,
  name: string
): void {
  if (value.programDateTime !== undefined) {
    assertIsoDateField(value, "programDateTime", name);
  }

  if (value.independent !== undefined) {
    assertBooleanField(value, "independent", name);
  }

  if (value.byterange !== undefined) {
    assertByterange(value.byterange, `${name}.byterange`);
  }
}

// `allowed` widens the closed field set for callers that layer extra fields
// on the shared object shape (committed parts); standalone committed objects
// use the default list.
function assertCommittedObject(
  value: unknown,
  name: string,
  allowed: readonly string[] = COMMITTED_OBJECT_FIELDS
): asserts value is CommittedObject {
  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }

  assertOnlyKnownFields(value, allowed, name);
  assertUrlSafeField(value, "commitId", name);
  assertUrlSafeField(value, "slotId", name);
  assertSafeObjectKey(value.objectKey, `${name}.objectKey`);
  assertSafeDeliveryUrl(value.deliveryUrl, `${name}.deliveryUrl`);

  if (value.contentType !== undefined) {
    assertNonEmptyStringField(value, "contentType", name);
  }

  if (value.duration !== undefined) {
    assertPositiveNumberField(value, "duration", name);
  }

  if (value.etag !== undefined) {
    assertNonEmptyStringField(value, "etag", name);
  }
}
