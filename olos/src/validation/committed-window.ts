import type {
  CommittedSegment,
  CommittedWindow,
} from "../types/committed-window";
import { BYTERANGE_FIELDS } from "./byterange";
import {
  assertCommittedObject,
  assertMonotonicSegments,
} from "./committed-window-parts";
import {
  assertNonNegativeIntegerField,
  assertOnlyKnownFields,
  assertUrlSafeField,
  isRecord,
  type KnownFieldsShape,
  nonEmptyArray,
} from "./fields";

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

export const COMMITTED_SEGMENT_FIELDS = [
  "discontinuityBefore",
  "duration",
  "independent",
  "mediaSequenceNumber",
  "parts",
  "programDateTime",
  "segment",
] as const;

export const COMMITTED_OBJECT_FIELDS = [
  "commitId",
  "contentType",
  "deliveryUrl",
  "duration",
  "etag",
  "objectKey",
  "slotId",
] as const;

export const COMMITTED_PART_FIELDS = [
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

export interface CommittedPartPositionTracker {
  previousPart: number;
  seenParts: Map<number, string>;
}

export interface CommittedSegmentPositionTracker {
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
