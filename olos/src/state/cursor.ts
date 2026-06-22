import { OLOS_WIRE_VERSION } from "../index";
import type {
  CommittedObject,
  CommittedPart,
  CommittedSegment,
  CommittedWindow,
  RenditionWindow,
} from "../types/committed-window";
import type { Cursor } from "../types/cursor";
import type { OlosError } from "../types/errors";
import type { PartNumber } from "../types/ids";
import type { Pathway } from "../types/pathway";
import type { LatencyProfile, SessionState } from "../types/session";
import { assertCursor } from "../validation/cursor";

const SEGMENT_ONLY_CURSOR_PART_ORDER = -1;

export interface CreateCursorOptions {
  committedWindow: CommittedWindow;
  lastPartNumber?: PartNumber;
  latencyProfile: LatencyProfile;
  partTarget: number;
  pathways: readonly Pathway[];
  segmentTarget: number;
  sessionId: string;
  state: SessionState;
  tenantId: string;
  updatedAt: string;
}

export interface ResolveCursorUpdateOptions {
  candidateCursor: Cursor;
  currentCursor: Cursor;
}

export type CursorUpdateResolution =
  | {
      cursor: Cursor;
      status: "advanced" | "idempotent";
    }
  | {
      error: OlosError;
      status: "regression";
    };

export function createCursor(options: CreateCursorOptions): Cursor {
  const cursor: Cursor = {
    committedWindow: options.committedWindow,
    epoch: options.committedWindow.epoch,
    latencyProfile: options.latencyProfile,
    olos: OLOS_WIRE_VERSION,
    partTarget: options.partTarget,
    pathways: [...options.pathways],
    segmentTarget: options.segmentTarget,
    sessionId: options.sessionId,
    state: options.state,
    tenantId: options.tenantId,
    updatedAt: options.updatedAt,
    window: {
      firstMediaSequenceNumber:
        options.committedWindow.firstMediaSequenceNumber,
      lastMediaSequenceNumber: options.committedWindow.lastMediaSequenceNumber,
      ...(options.lastPartNumber === undefined
        ? {}
        : { lastPartNumber: options.lastPartNumber }),
    },
  };

  assertCursor(cursor);
  return cursor;
}

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
          candidateLastMediaSequenceNumber:
            options.candidateCursor.window.lastMediaSequenceNumber,
          currentLastMediaSequenceNumber:
            options.currentCursor.window.lastMediaSequenceNumber,
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
      first.window.lastMediaSequenceNumber,
      second.window.lastMediaSequenceNumber
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
    firstWindow.discontinuitySequence === secondWindow.discontinuitySequence &&
    firstWindow.epoch === secondWindow.epoch &&
    firstWindow.firstMediaSequenceNumber ===
      secondWindow.firstMediaSequenceNumber &&
    firstWindow.lastMediaSequenceNumber ===
      secondWindow.lastMediaSequenceNumber &&
    sameRenditions(firstWindow.renditions, secondWindow.renditions)
  );
}

function sameRenditions(
  first: Record<string, RenditionWindow>,
  second: Record<string, RenditionWindow>
): boolean {
  const firstRenditionIds = Object.keys(first);

  if (firstRenditionIds.length !== Object.keys(second).length) {
    return false;
  }

  for (const renditionId of firstRenditionIds) {
    const firstRendition = first[renditionId];
    const secondRendition = second[renditionId];

    if (
      firstRendition === undefined ||
      secondRendition === undefined ||
      !sameRendition(firstRendition, secondRendition)
    ) {
      return false;
    }
  }

  return true;
}

function sameRendition(
  first: RenditionWindow,
  second: RenditionWindow
): boolean {
  return (
    first.renditionId === second.renditionId &&
    sameCommittedObject(first.init, second.init) &&
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
    first.discontinuityBefore === second.discontinuityBefore &&
    first.duration === second.duration &&
    first.independent === second.independent &&
    first.mediaSequenceNumber === second.mediaSequenceNumber &&
    first.programDateTime === second.programDateTime &&
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
    first.duration === second.duration &&
    first.independent === second.independent &&
    first.partNumber === second.partNumber &&
    first.programDateTime === second.programDateTime &&
    sameCommittedObject(first, second)
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
    first.duration === second.duration &&
    first.etag === second.etag &&
    first.objectKey === second.objectKey &&
    first.slotId === second.slotId
  );
}
