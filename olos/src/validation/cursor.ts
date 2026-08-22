import type { CommittedWindow } from "../types/committed-window";
import type { Cursor, CursorWindow } from "../types/cursor";
import { OLOS_WIRE_VERSION, SESSION_STATES } from "../types/session";
import {
  assertCommittedWindow,
  assertCommittedWindowSequence,
  COMMITTED_WINDOW_SHAPE,
  lastVisiblePartNumber,
} from "./committed-window";
import { assertSafeDeliveryUrl } from "./delivery-url";
import {
  assertIsoDateField,
  assertKnownFieldsObject,
  assertNonNegativeIntegerField,
  assertOneOfField,
  assertOnlyKnownFields,
  assertUrlSafeField,
  isRecord,
  type KnownFieldsShape,
  parseWithShape,
  passes,
} from "./fields";
import { assertStreamProfile } from "./profile";

const CURSOR_FIELDS = [
  "committedWindow",
  "deliveryBaseUrl",
  "epoch",
  "olos",
  "profile",
  "sessionId",
  "state",
  "updatedAt",
  "window",
] as const;

const CURSOR_WINDOW_FIELDS = [
  "firstSequenceNumber",
  "lastSequenceNumber",
  "lastPartNumber",
] as const;

const CURSOR_SHAPE: KnownFieldsShape = {
  fields: CURSOR_FIELDS,
  nested: {
    committedWindow: { kind: "object", shape: COMMITTED_WINDOW_SHAPE },
    window: { kind: "object", shape: { fields: CURSOR_WINDOW_FIELDS } },
  },
};

/** Returns whether `value` is a valid `Cursor` (see `assertCursor`). */
export function isCursor(value: unknown): value is Cursor {
  return passes(assertCursor, value);
}

/**
 * Validates an untrusted value as a wire-format `Cursor`, throwing an
 * `Error` naming the first offending field. Checks the `olos` wire version,
 * rejects unknown fields, requires a `profile` with an `id`, validates the
 * embedded committed window, and requires the cursor's `window` bounds and
 * epoch to agree with it.
 */
export function assertCursor(value: unknown): asserts value is Cursor {
  if (!isRecord(value)) {
    throw new Error("cursor must be an object");
  }

  if (value.olos !== OLOS_WIRE_VERSION) {
    throw new Error(`cursor.olos must be ${OLOS_WIRE_VERSION}`);
  }

  assertOnlyKnownFields(value, CURSOR_FIELDS, "cursor");
  assertCursorFields(value);
  assertSafeDeliveryUrl(value.deliveryBaseUrl, "cursor.deliveryBaseUrl");

  const cursorWindow = value.window;
  assertCursorWindow(cursorWindow);
  assertCommittedWindow(value.committedWindow);
  assertCursorCommittedWindow(value, cursorWindow, value.committedWindow);
}

/**
 * Tolerant read-path parser for a wire-format `Cursor` (spec §11.2):
 * unknown fields — at the top level and inside the embedded committed
 * window — are stripped from a fresh copy, which is then validated by the
 * unchanged closed `assertCursor` and returned. Known fields are still
 * rejected when invalid. Profile data is passed through untouched.
 */
export function parseCursor(value: unknown): Cursor {
  return parseWithShape(value, CURSOR_SHAPE, assertCursor);
}

function assertCursorFields(value: Record<string, unknown>): void {
  assertUrlSafeField(value, "sessionId", "cursor");
  assertOneOfField(value, "state", SESSION_STATES, "cursor");
  assertNonNegativeIntegerField(value, "epoch", "cursor");
  assertIsoDateField(value, "updatedAt", "cursor");
  assertStreamProfile(value.profile, "cursor.profile");
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
    cursorWindow.firstSequenceNumber !== committedWindow.firstSequenceNumber ||
    cursorWindow.lastSequenceNumber !== committedWindow.lastSequenceNumber
  ) {
    throw new Error("cursor.window must match committedWindow sequence bounds");
  }

  // §3.8: when present, lastPartNumber MUST equal the committed window's
  // last visible part number; absence is always allowed.
  if (
    cursorWindow.lastPartNumber !== undefined &&
    cursorWindow.lastPartNumber !== lastVisiblePartNumber(committedWindow)
  ) {
    throw new Error(
      "cursor.window.lastPartNumber must equal the committed window's last visible part number"
    );
  }
}

export function assertCursorWindow(
  value: unknown,
  name = "cursor.window"
): asserts value is CursorWindow {
  assertKnownFieldsObject(value, CURSOR_WINDOW_FIELDS, name);
  assertNonNegativeIntegerField(value, "firstSequenceNumber", name);
  assertNonNegativeIntegerField(value, "lastSequenceNumber", name);
  assertCommittedWindowSequence(value, name);

  if (value.lastPartNumber !== undefined) {
    assertNonNegativeIntegerField(value, "lastPartNumber", name);
  }
}
