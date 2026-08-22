import type {
  CommittedObject,
  CommittedPart,
  CommittedSegment,
} from "../types/committed-window";
import { assertByterange } from "./byterange";
import type {
  CommittedPartPositionTracker,
  CommittedSegmentPositionTracker,
} from "./committed-window";
import { assertContentType } from "./content-type";
import { assertSafeDeliveryUrl } from "./delivery-url";
import {
  assertKnownFieldsObject,
  assertNonEmptyStringField,
  assertNonNegativeIntegerField,
  assertUrlSafeField,
  isRecord,
  nonEmptyArray,
} from "./fields";
import { assertSafeObjectKey } from "./object-key";
import { assertOptionalProfileField } from "./profile";

/** Every field a wire-format `CommittedObject` may carry. */
export const COMMITTED_OBJECT_FIELDS = [
  "commitId",
  "contentType",
  "deliveryUrl",
  "etag",
  "objectKey",
  "profile",
  "slotId",
] as const;

/** Every field a wire-format `CommittedPart` may carry. */
export const COMMITTED_PART_FIELDS = [
  ...COMMITTED_OBJECT_FIELDS,
  "byterange",
  "partNumber",
] as const;

/** Every field a wire-format `CommittedSegment` may carry. */
export const COMMITTED_SEGMENT_FIELDS = [
  "parts",
  "segment",
  "sequenceNumber",
] as const;

export function assertMonotonicSegments(
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

  positions.seenSegments.add(segment.sequenceNumber);
  positions.previousSequence = segment.sequenceNumber;
}

function assertUniqueSegmentPosition(
  segment: CommittedSegment,
  seenSegments: Set<number>,
  name: string
): void {
  if (seenSegments.has(segment.sequenceNumber)) {
    throw new Error(`${name}.segments must not contain duplicate positions`);
  }
}

function assertMonotonicSegmentSequence(
  segment: CommittedSegment,
  previousSequence: number,
  name: string
): void {
  if (segment.sequenceNumber <= previousSequence) {
    throw new Error(`${name}.segments must have monotonic sequence numbers`);
  }
}

function assertCommittedSegment(
  value: unknown,
  trackName: string
): asserts value is CommittedSegment {
  const name = `${trackName}.segments[]`;

  assertKnownFieldsObject(value, COMMITTED_SEGMENT_FIELDS, name);
  assertNonNegativeIntegerField(value, "sequenceNumber", name);
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

  if (value.byterange !== undefined) {
    assertByterange(value.byterange, `${name}.byterange`);
  }
}

// `allowed` widens the closed field set for callers that layer extra fields
// on the shared object shape (committed parts); standalone committed objects
// use the default list.
export function assertCommittedObject(
  value: unknown,
  name: string,
  allowed: readonly string[] = COMMITTED_OBJECT_FIELDS
): asserts value is CommittedObject {
  assertKnownFieldsObject(value, allowed, name);
  assertUrlSafeField(value, "commitId", name);
  assertUrlSafeField(value, "slotId", name);
  assertSafeObjectKey(value.objectKey, `${name}.objectKey`);
  assertSafeDeliveryUrl(value.deliveryUrl, `${name}.deliveryUrl`);

  if (value.contentType !== undefined) {
    assertContentType(value.contentType, `${name}.contentType`);
  }

  if (value.etag !== undefined) {
    assertNonEmptyStringField(value, "etag", name);
  }

  assertOptionalProfileField(value, name);
}
