import type {
  CommittedObject,
  CommittedPart,
  CommittedSegment,
  CommittedWindow,
} from "../types/committed-window";
import { assertSafeDeliveryUrl } from "./delivery-url";
import {
  assertBooleanField,
  assertIsoDateField,
  assertNonEmptyStringField,
  assertNonNegativeIntegerField,
  assertPositiveNumberField,
  assertUrlSafeField,
  isRecord,
} from "./fields";
import { assertSafeObjectKey } from "./object-key";

export function isCommittedWindow(value: unknown): value is CommittedWindow {
  try {
    assertCommittedWindow(value);
    return true;
  } catch {
    return false;
  }
}

export function assertCommittedWindow(
  value: unknown
): asserts value is CommittedWindow {
  if (!isRecord(value)) {
    throw new Error("committedWindow must be an object");
  }

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

  assertUrlSafeField(value, "renditionId", name);

  if (value.renditionId !== key) {
    throw new Error(`${name}.renditionId must match its renditions key`);
  }

  assertCommittedObject(value.init, `${name}.init`);

  if (!Array.isArray(value.segments) || value.segments.length === 0) {
    throw new Error(`${name}.segments must be a non-empty array`);
  }

  assertMonotonicSegments(value.segments, name);
}

function assertMonotonicSegments(
  segments: readonly unknown[],
  name: string
): void {
  let previousSequence = -1;
  const seenSegments = new Set<number>();

  for (const segment of segments) {
    assertCommittedSegment(segment, name);

    if (seenSegments.has(segment.mediaSequenceNumber)) {
      throw new Error(`${name}.segments must not contain duplicate positions`);
    }

    if (segment.mediaSequenceNumber <= previousSequence) {
      throw new Error(`${name}.segments must have monotonic media sequences`);
    }

    seenSegments.add(segment.mediaSequenceNumber);
    previousSequence = segment.mediaSequenceNumber;
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

  assertNonNegativeIntegerField(value, "mediaSequenceNumber", name);
  assertPositiveNumberField(value, "duration", name);

  if (value.programDateTime !== undefined) {
    assertIsoDateField(value, "programDateTime", name);
  }

  if (value.discontinuityBefore !== undefined) {
    assertBooleanField(value, "discontinuityBefore", name);
  }

  if (value.independent !== undefined) {
    assertBooleanField(value, "independent", name);
  }

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
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${segmentName}.parts must be a non-empty array`);
  }

  let previousPart = -1;
  const seenParts = new Map<number, string>();

  for (const part of value) {
    assertCommittedPart(part, segmentName);

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

    if (part.partNumber <= previousPart) {
      throw new Error(`${segmentName}.parts must have monotonic part numbers`);
    }

    seenParts.set(part.partNumber, part.deliveryUrl);
    previousPart = part.partNumber;
  }
}

function assertCommittedPart(
  value: unknown,
  segmentName: string
): asserts value is CommittedPart {
  const name = `${segmentName}.parts[]`;

  assertCommittedObject(value, name);

  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }

  assertNonNegativeIntegerField(value, "partNumber", name);
  assertPositiveNumberField(value, "duration", name);

  if (value.programDateTime !== undefined) {
    assertIsoDateField(value, "programDateTime", name);
  }

  if (value.independent !== undefined) {
    assertBooleanField(value, "independent", name);
  }
}

function assertCommittedObject(
  value: unknown,
  name: string
): asserts value is CommittedObject {
  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }

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
