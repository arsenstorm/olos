import { OLOS_WIRE_VERSION } from "../protocol";
import type { CommittedWindow } from "../types/committed-window";
import type { Cursor } from "../types/cursor";
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
