import type { HlsCursorWaitContext } from "../hls";
import type { Cursor } from "../types/cursor";
import { assertCursor } from "../validation/cursor";

const SEGMENT_ONLY_CURSOR_PART_ORDER = -1;

export interface RuntimeCursorNotifier {
  notify(cursor: Cursor): void;
  waitForCursor(context: HlsCursorWaitContext): Promise<Cursor | undefined>;
}

interface CursorWaiter {
  after: Cursor;
  resolve(cursor: Cursor | undefined): void;
}

interface CursorProgress {
  epoch: number;
  lastMediaSequenceNumber: number;
  lastPartNumber: number;
}

export function createMemoryRuntimeCursorNotifier(): RuntimeCursorNotifier {
  const latest = new Map<string, Cursor>();
  const waiters = new Map<string, Set<CursorWaiter>>();

  return {
    notify(cursor) {
      assertCursor(cursor);
      latest.set(cursor.sessionId, cursor);

      const sessionWaiters = waiters.get(cursor.sessionId);
      if (sessionWaiters === undefined) {
        return;
      }

      resolveAdvancedWaiters(cursor, sessionWaiters);
      deleteEmptyWaiterSet(waiters, cursor.sessionId, sessionWaiters);
    },
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

function advancedLatestCursor(
  latest: ReadonlyMap<string, Cursor>,
  after: Cursor
): Cursor | undefined {
  const current = latest.get(after.sessionId);

  return current !== undefined && isCursorAfter(current, after)
    ? current
    : undefined;
}

function waitForAdvancedCursor(
  waiters: Map<string, Set<CursorWaiter>>,
  context: HlsCursorWaitContext
): Promise<Cursor | undefined> {
  return new Promise((resolve) => {
    const sessionWaiters = waitersForSession(waiters, context.cursor.sessionId);
    const waiter: CursorWaiter = {
      after: context.cursor,
      resolve,
    };
    const abort = () => {
      sessionWaiters.delete(waiter);
      resolve(undefined);
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
    if (isCursorAfter(cursor, waiter.after)) {
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
  if (sessionWaiters.size === 0) {
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

function isCursorAfter(cursor: Cursor, after: Cursor): boolean {
  if (cursor.sessionId !== after.sessionId) {
    return false;
  }

  return (
    compareCursorProgress(cursorProgress(cursor), cursorProgress(after)) > 0
  );
}

function compareCursorProgress(
  cursor: CursorProgress,
  after: CursorProgress
): number {
  return (
    compareNumber(cursor.epoch, after.epoch) ||
    compareNumber(
      cursor.lastMediaSequenceNumber,
      after.lastMediaSequenceNumber
    ) ||
    compareNumber(cursor.lastPartNumber, after.lastPartNumber)
  );
}

function cursorProgress(cursor: Cursor): CursorProgress {
  return {
    epoch: cursor.epoch,
    lastMediaSequenceNumber: cursor.window.lastMediaSequenceNumber,
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
