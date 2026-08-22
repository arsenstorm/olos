import type {
  CommittedSegment,
  CommittedWindow,
} from "../types/committed-window";
import { BYTERANGE_FIELDS } from "./byterange";
import {
  assertCommittedObject,
  assertMonotonicSegments,
  COMMITTED_OBJECT_FIELDS,
  COMMITTED_PART_FIELDS,
  COMMITTED_SEGMENT_FIELDS,
} from "./committed-window-parts";
import {
  assertKnownFieldsObject,
  assertNonNegativeIntegerField,
  assertUrlSafeField,
  isRecord,
  type KnownFieldsShape,
  nonEmptyArray,
  passes,
} from "./fields";
import { assertOptionalProfileField } from "./profile";

const COMMITTED_WINDOW_FIELDS = [
  "epoch",
  "firstSequenceNumber",
  "lastSequenceNumber",
  "tracks",
] as const;

const TRACK_WINDOW_FIELDS = ["init", "profile", "segments", "trackId"] as const;

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

const TRACK_WINDOW_SHAPE: KnownFieldsShape = {
  fields: TRACK_WINDOW_FIELDS,
  nested: {
    init: { kind: "object", shape: COMMITTED_OBJECT_SHAPE },
    segments: { kind: "array", shape: COMMITTED_SEGMENT_SHAPE },
  },
};

/**
 * `KnownFieldsShape` of a wire-format `CommittedWindow`, for tolerant
 * read-path pruning with `pruneUnknownFields` — tracks is a map of track
 * windows, each with committed objects, segments, and parts. Profile data
 * at every level is passed through untouched.
 */
export const COMMITTED_WINDOW_SHAPE: KnownFieldsShape = {
  fields: COMMITTED_WINDOW_FIELDS,
  nested: {
    tracks: { kind: "map", shape: TRACK_WINDOW_SHAPE },
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
 * across all tracks, or undefined when the last segment is a full segment
 * (no parts) or no segments exist.
 */
export function lastVisiblePartNumber(
  window: CommittedWindow
): number | undefined {
  let max: number | undefined;

  for (const track of Object.values(window.tracks)) {
    const lastSegment = track.segments.at(-1);

    if (lastSegment?.sequenceNumber !== window.lastSequenceNumber) {
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
  return passes(assertCommittedWindow, value);
}

/**
 * Validates an untrusted value as a `CommittedWindow`, throwing an `Error`
 * naming the first offending field. Rejects unknown fields at every level.
 * Beyond field shapes, it enforces the structural invariants consumers rely
 * on: non-empty tracks whose keys match their `trackId`, monotonic and
 * duplicate-free sequence numbers and part numbers, and a segment or parts
 * on every position. Profile data is only checked to be an object.
 */
export function assertCommittedWindow(
  value: unknown
): asserts value is CommittedWindow {
  assertKnownFieldsObject(value, COMMITTED_WINDOW_FIELDS, "committedWindow");
  assertNonNegativeIntegerField(value, "epoch", "committedWindow");
  assertNonNegativeIntegerField(
    value,
    "firstSequenceNumber",
    "committedWindow"
  );
  assertNonNegativeIntegerField(value, "lastSequenceNumber", "committedWindow");
  assertCommittedWindowSequence(value, "committedWindow");

  if (!isRecord(value.tracks) || Object.keys(value.tracks).length === 0) {
    throw new Error("committedWindow.tracks must be a non-empty object");
  }

  for (const [trackId, track] of Object.entries(value.tracks)) {
    assertTrackWindow(track, trackId);
  }
}

export function assertCommittedWindowSequence(
  value: Record<string, unknown>,
  name: string
): void {
  if (Number(value.firstSequenceNumber) > Number(value.lastSequenceNumber)) {
    throw new Error(
      `${name}.firstSequenceNumber must be less than or equal to lastSequenceNumber`
    );
  }
}

function assertTrackWindow(value: unknown, key: string): void {
  const name = `committedWindow.tracks.${key}`;

  assertKnownFieldsObject(value, TRACK_WINDOW_FIELDS, name);
  assertUrlSafeField(value, "trackId", name);

  if (value.trackId !== key) {
    throw new Error(`${name}.trackId must match its tracks key`);
  }

  if (value.init !== undefined) {
    assertCommittedObject(value.init, `${name}.init`);
  }

  assertOptionalProfileField(value, name);

  assertMonotonicSegments(
    nonEmptyArray<CommittedSegment>(value.segments, `${name}.segments`),
    name
  );
}
