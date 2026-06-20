import { OLOS_WIRE_VERSION } from "../index";
import type { CommittedWindow } from "../types/committed-window";
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
  return (
    JSON.stringify(first.committedWindow) ===
    JSON.stringify(second.committedWindow)
  );
}
