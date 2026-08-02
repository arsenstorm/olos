import { LATENCY_PROFILES, SESSION_STATES } from "../config/session";
import { OLOS_WIRE_VERSION } from "../index";
import type { CommittedWindow } from "../types/committed-window";
import type { Cursor, CursorWindow } from "../types/cursor";
import {
  assertCommittedWindow,
  COMMITTED_WINDOW_SHAPE,
  lastVisiblePartNumber,
} from "./committed-window";
import { assertSafeDeliveryUrl } from "./delivery-url";
import {
  assertIsoDateField,
  assertNonNegativeIntegerField,
  assertOneOfField,
  assertOnlyKnownFields,
  assertPositiveNumberField,
  assertUrlSafeField,
  isRecord,
  type KnownFieldsShape,
  pruneUnknownFields,
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

const CURSOR_SHAPE: KnownFieldsShape = {
  fields: CURSOR_FIELDS,
  nested: {
    committedWindow: { kind: "object", shape: COMMITTED_WINDOW_SHAPE },
    window: { kind: "object", shape: { fields: CURSOR_WINDOW_FIELDS } },
  },
};

/** Returns whether `value` is a valid `Cursor` (see `assertCursor`). */
export function isCursor(value: unknown): value is Cursor {
  try {
    assertCursor(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates an untrusted value as a wire-format `Cursor`, throwing an
 * `Error` naming the first offending field. Checks the `olos` wire version,
 * rejects unknown fields, validates the embedded committed window, and
 * requires the cursor's `window` bounds and epoch to agree with it.
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
  assertSafeDeliveryUrl(value.mediaBaseUrl, "cursor.mediaBaseUrl");

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
 * rejected when invalid.
 */
export function parseCursor(value: unknown): Cursor {
  const pruned = pruneUnknownFields(value, CURSOR_SHAPE);

  assertCursor(pruned);

  return pruned;
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
