import type { Cursor } from "@arsenstorm/olos/types";
import type { StreamCoordinator } from "./coordinator-do";

interface CursorWaitContext {
  cursor: Cursor;
  signal: AbortSignal;
}

export function createCursorWaiter(
  namespace: DurableObjectNamespace<StreamCoordinator>,
  timeoutMs: number
): (context: CursorWaitContext) => Promise<Cursor | undefined> {
  return async ({ cursor, signal }) => {
    if (signal.aborted) {
      return;
    }

    const stub = namespace.get(namespace.idFromName(cursor.sessionId));

    return await Promise.race([
      stub.waitForCursor(timeoutMs),
      abortablePromise(signal),
    ]);
  };
}

function abortablePromise(signal: AbortSignal): Promise<undefined> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(undefined);
      return;
    }
    signal.addEventListener("abort", () => resolve(undefined), { once: true });
  });
}
