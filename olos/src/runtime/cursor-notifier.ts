import type { HlsCursorWaitContext } from "../hls/blocking-reload";
import { isEndOfStreamSessionState } from "../state/session";
import type { Cursor } from "../types/cursor";
import { assertCursor } from "../validation/cursor";
import { isRecord } from "../validation/fields";

const SEGMENT_ONLY_CURSOR_PART_ORDER = -1;

/**
 * Bridges commits to blocking playlist reloads: the commit path calls
 * `notify` with each new cursor, and manifest serving calls `waitForCursor`
 * to hold a response open until the session advances.
 */
export interface RuntimeCursorNotifier {
  /** Publish a new cursor, waking waiters it counts as an update for. */
  notify(cursor: Cursor): void;
  /**
   * Resolve with the first cursor that is an update past `context.cursor`
   * — a strict global-position advance or a same-position content change —
   * or with `undefined` once `context.signal` aborts.
   */
  waitForCursor(context: HlsCursorWaitContext): Promise<Cursor | undefined>;
}

interface CursorWaiter {
  after: Cursor;
  resolve(cursor: Cursor | undefined): void;
}

interface CursorProgress {
  epoch: number;
  lastPartNumber: number;
  lastSequenceNumber: number;
}

/**
 * Create an in-process `RuntimeCursorNotifier` that tracks the latest cursor
 * per session in memory. `waitForCursor` resolves immediately when the
 * latest known cursor is already ahead of the caller's — ordered by epoch,
 * then sequence number, then part number — or sits at the same
 * position with different content. Suitable for a single-process
 * coordinator only — notifications do not cross processes.
 */
export function createMemoryRuntimeCursorNotifier(): RuntimeCursorNotifier {
  const latest = new Map<string, Cursor>();
  const waiters = new Map<string, Set<CursorWaiter>>();

  return {
    notify: (cursor) => notifyCursorAdvance(latest, waiters, cursor),
    waitForCursor(context) {
      assertCursor(context.cursor);

      if (context.signal.aborted) {
        return Promise.resolve(undefined);
      }

      const advanced = advancedLatestCursor(latest, context.cursor);

      if (advanced !== undefined) {
        return Promise.resolve(advanced);
      }

      return waitForAdvancedCursor(waiters, context);
    },
  };
}

function notifyCursorAdvance(
  latest: Map<string, Cursor>,
  waiters: Map<string, Set<CursorWaiter>>,
  cursor: Cursor
): void {
  assertCursor(cursor);

  // Terminal cursors evict the session so a long-lived notifier does not
  // accumulate an entry per session ever seen; blocking reloads resolve
  // terminal sessions from the stored cursor, not from here.
  if (isEndOfStreamSessionState(cursor.state)) {
    latest.delete(cursor.sessionId);
  } else {
    latest.set(cursor.sessionId, cursor);
  }

  const sessionWaiters = waiters.get(cursor.sessionId);
  if (sessionWaiters === undefined) {
    return;
  }

  resolveAdvancedWaiters(cursor, sessionWaiters);
  deleteEmptyWaiterSet(waiters, cursor.sessionId, sessionWaiters);
}

function advancedLatestCursor(
  latest: ReadonlyMap<string, Cursor>,
  after: Cursor
): Cursor | undefined {
  const current = latest.get(after.sessionId);

  return current !== undefined && isCursorUpdateAfter(current, after)
    ? current
    : undefined;
}

function waitForAdvancedCursor(
  waiters: Map<string, Set<CursorWaiter>>,
  context: HlsCursorWaitContext
): Promise<Cursor | undefined> {
  return new Promise((resolve) => {
    const sessionId = context.cursor.sessionId;
    const sessionWaiters = waitersForSession(waiters, sessionId);

    function abort(): void {
      sessionWaiters.delete(waiter);
      deleteEmptyWaiterSet(waiters, sessionId, sessionWaiters);
      resolve(undefined);
    }

    const waiter: CursorWaiter = {
      after: context.cursor,
      resolve(cursor) {
        context.signal.removeEventListener("abort", abort);
        resolve(cursor);
      },
    };

    context.signal.addEventListener("abort", abort, { once: true });
    sessionWaiters.add(waiter);
  });
}

function resolveAdvancedWaiters(
  cursor: Cursor,
  sessionWaiters: Set<CursorWaiter>
): void {
  for (const waiter of sessionWaiters) {
    if (isCursorUpdateAfter(cursor, waiter.after)) {
      sessionWaiters.delete(waiter);
      waiter.resolve(cursor);
    }
  }
}

function deleteEmptyWaiterSet(
  waiters: Map<string, Set<CursorWaiter>>,
  sessionId: string,
  sessionWaiters: Set<CursorWaiter>
): void {
  if (sessionWaiters.size === 0 && waiters.get(sessionId) === sessionWaiters) {
    waiters.delete(sessionId);
  }
}

function waitersForSession(
  waiters: Map<string, Set<CursorWaiter>>,
  sessionId: string
): Set<CursorWaiter> {
  const current = waiters.get(sessionId);

  if (current !== undefined) {
    return current;
  }

  const next = new Set<CursorWaiter>();
  waiters.set(sessionId, next);
  return next;
}

// Same-position updates (§4.5.3: a lagging track catching up, a session
// state change) may be exactly what per-track waiters block on, so any
// difference wakes; only an equivalent cursor must never wake.
function isCursorUpdateAfter(cursor: Cursor, after: Cursor): boolean {
  if (cursor.sessionId !== after.sessionId) {
    return false;
  }

  const order = compareCursorProgress(
    cursorProgress(cursor),
    cursorProgress(after)
  );

  if (order !== 0) {
    return order > 0;
  }

  return !isStructurallyEqualJson(cursor, after);
}

// Cursors are validated, JSON-shaped values (no cycles, functions, or
// undefined members), so a structural walk is a faithful equivalence check.
function isStructurallyEqualJson(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => isStructurallyEqualJson(entry, right[index]))
    );
  }

  if (!(isRecord(left) && isRecord(right))) {
    return false;
  }

  const leftKeys = Object.keys(left);

  return (
    leftKeys.length === Object.keys(right).length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        isStructurallyEqualJson(left[key], right[key])
    )
  );
}

function compareCursorProgress(
  cursor: CursorProgress,
  after: CursorProgress
): number {
  return (
    compareNumber(cursor.epoch, after.epoch) ||
    compareNumber(cursor.lastSequenceNumber, after.lastSequenceNumber) ||
    compareNumber(cursor.lastPartNumber, after.lastPartNumber)
  );
}

function cursorProgress(cursor: Cursor): CursorProgress {
  return {
    epoch: cursor.epoch,
    lastSequenceNumber: cursor.window.lastSequenceNumber,
    lastPartNumber:
      cursor.window.lastPartNumber ?? SEGMENT_ONLY_CURSOR_PART_ORDER,
  };
}

function compareNumber(left: number, right: number): number {
  if (left === right) {
    return 0;
  }

  return left > right ? 1 : -1;
}
