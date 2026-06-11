import { OLOS_WIRE_VERSION } from "../protocol";
import type { CommittedWindow } from "../types/committed-window";
import type { Cursor } from "../types/cursor";
import type { OlosError } from "../types/errors";
import type { PartNumber } from "../types/ids";
import type { Pathway } from "../types/pathway";
import type { LatencyProfile, SessionState } from "../types/session";
import { assertCursor } from "../validation/cursor";

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
      first.window.lastPartNumber ?? -1,
      second.window.lastPartNumber ?? -1
    )
  );
}

function compareNumber(first: number, second: number): number {
  return Math.sign(first - second);
}
