import { LATENCY_PROFILES, SESSION_STATES } from "../config/session";
import { OLOS_WIRE_VERSION } from "../index";
import type { CommittedWindow } from "../types/committed-window";
import type { Cursor, CursorWindow } from "../types/cursor";
import { assertCommittedWindow } from "./committed-window";
import { assertSafeDeliveryUrl } from "./delivery-url";
import {
  assertIsoDateField,
  assertNonNegativeIntegerField,
  assertOneOfField,
  assertOnlyKnownFields,
  assertPositiveNumberField,
  assertUrlSafeField,
  isRecord,
} from "./fields";

const CURSOR_FIELDS = [
  "committedWindow",
  "epoch",
  "latencyProfile",
  "mediaBaseUrl",
  "olos",
  "partTarget",
  "segmentTarget",
  "sessionId",
  "state",
  "updatedAt",
  "window",
] as const;

const CURSOR_WINDOW_FIELDS = [
  "firstMediaSequenceNumber",
  "lastMediaSequenceNumber",
  "lastPartNumber",
] as const;

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

  assertOnlyKnownFields(value, CURSOR_FIELDS, "cursor");
  assertCursorFields(value);
  assertSafeDeliveryUrl(value.mediaBaseUrl, "cursor.mediaBaseUrl");

  const cursorWindow = value.window;
  assertCursorWindow(cursorWindow);
  assertCommittedWindow(value.committedWindow);
  assertCursorCommittedWindow(value, cursorWindow, value.committedWindow);
}

function assertCursorFields(value: Record<string, unknown>): void {
  assertUrlSafeField(value, "sessionId", "cursor");
  assertOneOfField(value, "state", SESSION_STATES, "cursor");
  assertOneOfField(value, "latencyProfile", LATENCY_PROFILES, "cursor");
  assertNonNegativeIntegerField(value, "epoch", "cursor");
  assertPositiveNumberField(value, "segmentTarget", "cursor");
  assertPositiveNumberField(value, "partTarget", "cursor");
  assertIsoDateField(value, "updatedAt", "cursor");
}

function assertCursorCommittedWindow(
  cursor: Record<string, unknown>,
  cursorWindow: CursorWindow,
  committedWindow: CommittedWindow
): void {
  assertCursorEpochMatchesCommittedWindow(cursor, committedWindow);
  assertCursorWindowMatchesCommittedWindow(cursorWindow, committedWindow);
}

function assertCursorEpochMatchesCommittedWindow(
  cursor: Record<string, unknown>,
  committedWindow: CommittedWindow
): void {
  if (cursor.epoch !== committedWindow.epoch) {
    throw new Error("cursor.epoch must match committedWindow.epoch");
  }
}

function assertCursorWindowMatchesCommittedWindow(
  cursorWindow: CursorWindow,
  committedWindow: CommittedWindow
): void {
  if (
    cursorWindow.firstMediaSequenceNumber !==
      committedWindow.firstMediaSequenceNumber ||
    cursorWindow.lastMediaSequenceNumber !==
      committedWindow.lastMediaSequenceNumber
  ) {
    throw new Error("cursor.window must match committedWindow media sequence");
  }
}

export function assertCursorWindow(
  value: unknown,
  name = "cursor.window"
): asserts value is CursorWindow {
  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }

  assertOnlyKnownFields(value, CURSOR_WINDOW_FIELDS, name);
  assertNonNegativeIntegerField(value, "firstMediaSequenceNumber", name);
  assertNonNegativeIntegerField(value, "lastMediaSequenceNumber", name);
  assertCursorWindowSequence(value, name);

  if (value.lastPartNumber !== undefined) {
    assertNonNegativeIntegerField(value, "lastPartNumber", name);
  }
}

function assertCursorWindowSequence(
  value: Record<string, unknown>,
  name: string
): void {
  if (
    Number(value.firstMediaSequenceNumber) >
    Number(value.lastMediaSequenceNumber)
  ) {
    throw new Error(
      `${name}.firstMediaSequenceNumber must be less than or equal to lastMediaSequenceNumber`
    );
  }
}
