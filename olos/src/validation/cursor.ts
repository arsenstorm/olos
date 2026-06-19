import { LATENCY_PROFILES, SESSION_STATES } from "../config/session";
import { OLOS_WIRE_VERSION } from "../index";
import type { CommittedWindow } from "../types/committed-window";
import type { Cursor, CursorWindow } from "../types/cursor";
import { assertCommittedWindow } from "./committed-window";
import {
  assertIsoDateField,
  assertNonNegativeIntegerField,
  assertOneOfField,
  assertPositiveNumberField,
  assertUrlSafeField,
  isRecord,
} from "./fields";
import { assertPathway } from "./pathway";

export function isCursor(value: unknown): value is Cursor {
  try {
    assertCursor(value);
    return true;
  } catch {
    return false;
  }
}

export function assertCursor(value: unknown): asserts value is Cursor {
  if (!isRecord(value)) {
    throw new Error("cursor must be an object");
  }

  if (value.olos !== OLOS_WIRE_VERSION) {
    throw new Error(`cursor.olos must be ${OLOS_WIRE_VERSION}`);
  }

  assertUrlSafeField(value, "tenantId", "cursor");
  assertUrlSafeField(value, "sessionId", "cursor");
  assertOneOfField(value, "state", SESSION_STATES, "cursor");
  assertOneOfField(value, "latencyProfile", LATENCY_PROFILES, "cursor");
  assertNonNegativeIntegerField(value, "epoch", "cursor");
  assertPositiveNumberField(value, "segmentTarget", "cursor");
  assertPositiveNumberField(value, "partTarget", "cursor");
  assertIsoDateField(value, "updatedAt", "cursor");
  assertPathways(value.pathways);
  const cursorWindow = value.window;
  assertCursorWindow(cursorWindow);
  assertCommittedWindow(value.committedWindow);
  assertCursorCommittedWindow(value, cursorWindow, value.committedWindow);
}

function assertCursorCommittedWindow(
  cursor: Record<string, unknown>,
  cursorWindow: CursorWindow,
  committedWindow: CommittedWindow
): void {
  if (cursor.epoch !== committedWindow.epoch) {
    throw new Error("cursor.epoch must match committedWindow.epoch");
  }

  if (
    cursorWindow.firstMediaSequenceNumber !==
      committedWindow.firstMediaSequenceNumber ||
    cursorWindow.lastMediaSequenceNumber !==
      committedWindow.lastMediaSequenceNumber
  ) {
    throw new Error("cursor.window must match committedWindow media sequence");
  }
}

function assertCursorWindow(value: unknown): asserts value is CursorWindow {
  if (!isRecord(value)) {
    throw new Error("cursor.window must be an object");
  }

  assertNonNegativeIntegerField(
    value,
    "firstMediaSequenceNumber",
    "cursor.window"
  );
  assertNonNegativeIntegerField(
    value,
    "lastMediaSequenceNumber",
    "cursor.window"
  );
  assertCursorWindowSequence(value);

  if (value.lastPartNumber !== undefined) {
    assertNonNegativeIntegerField(value, "lastPartNumber", "cursor.window");
  }
}

function assertCursorWindowSequence(value: Record<string, unknown>): void {
  if (
    Number(value.firstMediaSequenceNumber) >
    Number(value.lastMediaSequenceNumber)
  ) {
    throw new Error(
      "cursor.window.firstMediaSequenceNumber must be less than or equal to lastMediaSequenceNumber"
    );
  }
}

function assertPathways(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("cursor.pathways must be a non-empty array");
  }

  const seenPathways = new Set<string>();

  for (const pathway of value) {
    assertPathway(pathway);

    if (seenPathways.has(pathway.pathwayId as string)) {
      throw new Error("cursor.pathways must not contain duplicate pathway IDs");
    }

    seenPathways.add(pathway.pathwayId as string);
  }
}
