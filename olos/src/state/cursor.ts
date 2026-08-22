import { OLOS_WIRE_VERSION } from "../index";
import type {
  CommittedObject,
  CommittedPart,
  CommittedSegment,
  CommittedWindow,
  TrackWindow,
} from "../types/committed-window";
import type { Cursor } from "../types/cursor";
import type { OlosError } from "../types/errors";
import type { PartNumber } from "../types/ids";
import type { StreamProfile } from "../types/profile";
import type { SessionState } from "../types/session";
import { assertCursor } from "../validation/cursor";
import { sameProfileData } from "./profile-data";

const SEGMENT_ONLY_CURSOR_PART_ORDER = -1;

/** Options for {@link createCursor}. */
export interface CreateCursorOptions {
  committedWindow: CommittedWindow;
  /** Base URL that relative delivery URLs in the window resolve against. */
  deliveryBaseUrl: string;
  /** Highest committed part number within the window's last segment. */
  lastPartNumber?: PartNumber;
  /** The session's profile, copied unchanged onto the cursor. */
  profile: StreamProfile;
  sessionId: string;
  state: SessionState;
  /** ISO timestamp of the commit that produced this cursor. */
  updatedAt: string;
}

/** Options for {@link resolveCursorUpdate}. */
export interface ResolveCursorUpdateOptions {
  candidateCursor: Cursor;
  currentCursor: Cursor;
}

/**
 * Outcome of {@link resolveCursorUpdate}: `advanced` adopts the candidate,
 * `idempotent` keeps the current cursor, and `regression` rejects a
 * candidate behind the current position with an `olos.cursor_regression`
 * error.
 */
export type CursorUpdateResolution =
  | {
      cursor: Cursor;
      status: "advanced" | "idempotent";
    }
  | {
      error: OlosError;
      status: "regression";
    };

/**
 * Build the {@link Cursor} document published to delivery edges for a
 * committed window. The epoch and window bounds are copied from
 * `committedWindow` and the OLOS wire version is stamped automatically.
 * Pure; throws when the resulting cursor fails validation.
 */
export function createCursor(options: CreateCursorOptions): Cursor {
  const cursor: Cursor = {
    committedWindow: options.committedWindow,
    deliveryBaseUrl: options.deliveryBaseUrl,
    epoch: options.committedWindow.epoch,
    olos: OLOS_WIRE_VERSION,
    profile: options.profile,
    sessionId: options.sessionId,
    state: options.state,
    updatedAt: options.updatedAt,
    window: {
      firstSequenceNumber: options.committedWindow.firstSequenceNumber,
      lastSequenceNumber: options.committedWindow.lastSequenceNumber,
      ...(options.lastPartNumber === undefined
        ? {}
        : { lastPartNumber: options.lastPartNumber }),
    },
  };

  assertCursor(cursor);
  return cursor;
}

/**
 * Decide whether a candidate cursor may replace the current one. Position
 * is compared by epoch, then last media sequence number, then last part
 * number (a segment-only cursor sorts before any part). A candidate ahead
 * of the current position is `advanced`; one at the same position is
 * `advanced` when its committed window content differs and `idempotent`
 * when the windows are deep-equal; one behind the current position is a
 * `regression` and must not be published. Pure.
 */
export function resolveCursorUpdate(
  options: ResolveCursorUpdateOptions
): CursorUpdateResolution {
  assertCursor(options.currentCursor);
  assertCursor(options.candidateCursor);

  const comparison = compareCursorPosition(
    options.candidateCursor,
    options.currentCursor
  );

  if (comparison > 0) {
    return {
      cursor: options.candidateCursor,
      status: "advanced",
    };
  }

  if (comparison === 0) {
    return resolveSamePositionCursorUpdate(options);
  }

  return cursorRegression(options);
}

function resolveSamePositionCursorUpdate(
  options: ResolveCursorUpdateOptions
): CursorUpdateResolution {
  if (!sameCommittedWindow(options.candidateCursor, options.currentCursor)) {
    return {
      cursor: options.candidateCursor,
      status: "advanced",
    };
  }

  return {
    cursor: options.currentCursor,
    status: "idempotent",
  };
}

function cursorRegression(
  options: ResolveCursorUpdateOptions
): CursorUpdateResolution {
  return {
    error: {
      error: {
        code: "olos.cursor_regression",
        details: {
          candidateLastSequenceNumber:
            options.candidateCursor.window.lastSequenceNumber,
          currentLastSequenceNumber:
            options.currentCursor.window.lastSequenceNumber,
          sessionId: options.currentCursor.sessionId,
        },
        message: "candidate cursor is behind the current cursor",
      },
    },
    status: "regression",
  };
}

function compareCursorPosition(first: Cursor, second: Cursor): number {
  return (
    compareNumber(first.epoch, second.epoch) ||
    compareNumber(
      first.window.lastSequenceNumber,
      second.window.lastSequenceNumber
    ) ||
    compareNumber(
      first.window.lastPartNumber ?? SEGMENT_ONLY_CURSOR_PART_ORDER,
      second.window.lastPartNumber ?? SEGMENT_ONLY_CURSOR_PART_ORDER
    )
  );
}

function compareNumber(first: number, second: number): number {
  return Math.sign(first - second);
}

function sameCommittedWindow(first: Cursor, second: Cursor): boolean {
  const firstWindow = first.committedWindow;
  const secondWindow = second.committedWindow;

  return (
    sameCommittedWindowBounds(firstWindow, secondWindow) &&
    sameTrackWindows(firstWindow.tracks, secondWindow.tracks)
  );
}

function sameCommittedWindowBounds(
  first: CommittedWindow,
  second: CommittedWindow
): boolean {
  return (
    first.epoch === second.epoch &&
    first.firstSequenceNumber === second.firstSequenceNumber &&
    first.lastSequenceNumber === second.lastSequenceNumber
  );
}

function sameTrackWindows(
  first: Record<string, TrackWindow>,
  second: Record<string, TrackWindow>
): boolean {
  if (!sameTrackIds(first, second)) {
    return false;
  }

  return Object.keys(first).every((trackId) =>
    sameTrackWindowForId(first, second, trackId)
  );
}

function sameTrackIds(
  first: Record<string, TrackWindow>,
  second: Record<string, TrackWindow>
): boolean {
  const firstTrackIds = Object.keys(first);

  if (firstTrackIds.length !== Object.keys(second).length) {
    return false;
  }

  return firstTrackIds.every((trackId) => second[trackId] !== undefined);
}

function sameTrackWindowForId(
  first: Record<string, TrackWindow>,
  second: Record<string, TrackWindow>,
  trackId: string
): boolean {
  const firstTrack = first[trackId];
  const secondTrack = second[trackId];

  return (
    firstTrack !== undefined &&
    secondTrack !== undefined &&
    sameTrack(firstTrack, secondTrack)
  );
}

function sameTrack(first: TrackWindow, second: TrackWindow): boolean {
  return (
    first.trackId === second.trackId &&
    sameProfileData(first.profile, second.profile) &&
    sameOptionalCommittedObject(first.init, second.init) &&
    sameSegments(first.segments, second.segments)
  );
}

function sameSegments(
  first: readonly CommittedSegment[],
  second: readonly CommittedSegment[]
): boolean {
  return sameOrderedItems(first, second, sameSegment);
}

function sameSegment(
  first: CommittedSegment,
  second: CommittedSegment
): boolean {
  return (
    first.sequenceNumber === second.sequenceNumber &&
    sameOptionalCommittedObject(first.segment, second.segment) &&
    sameParts(first.parts, second.parts)
  );
}

function sameParts(
  first: readonly CommittedPart[] | undefined,
  second: readonly CommittedPart[] | undefined
): boolean {
  if (first === undefined || second === undefined) {
    return first === second;
  }

  return sameOrderedItems(first, second, samePart);
}

function sameOrderedItems<TItem>(
  first: readonly TItem[],
  second: readonly TItem[],
  sameItem: (first: TItem, second: TItem) => boolean
): boolean {
  if (first.length !== second.length) {
    return false;
  }

  return first.every((item, index) => {
    const other = second[index];

    return other !== undefined && sameItem(item, other);
  });
}

function samePart(first: CommittedPart, second: CommittedPart): boolean {
  return (
    first.partNumber === second.partNumber && sameCommittedObject(first, second)
  );
}

function sameOptionalCommittedObject(
  first: CommittedObject | undefined,
  second: CommittedObject | undefined
): boolean {
  if (first === undefined || second === undefined) {
    return first === second;
  }

  return sameCommittedObject(first, second);
}

function sameCommittedObject(
  first: CommittedObject,
  second: CommittedObject
): boolean {
  return (
    first.commitId === second.commitId &&
    first.contentType === second.contentType &&
    first.deliveryUrl === second.deliveryUrl &&
    first.etag === second.etag &&
    first.objectKey === second.objectKey &&
    sameProfileData(first.profile, second.profile) &&
    first.slotId === second.slotId
  );
}
