import type { HlsCursorWaitContext } from "../hls";
import type { Cursor } from "../types/cursor";
import { assertCursor } from "../validation/cursor";

export interface RuntimeCursorNotifier {
  notify(cursor: Cursor): void;
  waitForCursor(context: HlsCursorWaitContext): Promise<Cursor | undefined>;
}

interface CursorWaiter {
  after: Cursor;
  resolve(cursor: Cursor | undefined): void;
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

      for (const waiter of sessionWaiters) {
        if (isCursorAfter(cursor, waiter.after)) {
          sessionWaiters.delete(waiter);
          waiter.resolve(cursor);
        }
      }

      if (sessionWaiters.size === 0) {
        waiters.delete(cursor.sessionId);
      }
    },
    waitForCursor(context) {
      assertCursor(context.cursor);

      if (context.signal.aborted) {
        return Promise.resolve(undefined);
      }

      const current = latest.get(context.cursor.sessionId);

      if (current !== undefined && isCursorAfter(current, context.cursor)) {
        return Promise.resolve(current);
      }

      return new Promise((resolve) => {
        const sessionWaiters = waitersForSession(
          waiters,
          context.cursor.sessionId
        );
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
    },
  };
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

  if (cursor.epoch !== after.epoch) {
    return cursor.epoch > after.epoch;
  }

  if (
    cursor.window.lastMediaSequenceNumber !==
    after.window.lastMediaSequenceNumber
  ) {
    return (
      cursor.window.lastMediaSequenceNumber >
      after.window.lastMediaSequenceNumber
    );
  }

  return lastPartNumber(cursor) > lastPartNumber(after);
}

function lastPartNumber(cursor: Cursor): number {
  return cursor.window.lastPartNumber ?? -1;
}
