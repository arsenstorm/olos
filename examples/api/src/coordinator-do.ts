import { DurableObject } from "cloudflare:workers";
import type {
  SaveSerializedCoordinatorStoreOptions,
  SerializedCoordinatorStoreRecord,
  SerializedCoordinatorStoreSave,
} from "olos/protocol";
import { parseCoordinatorPipelineSnapshot } from "olos/protocol";
import type { Cursor } from "olos/types";

const RECORD_KEY = "coordinator-record";

interface CursorWaiter {
  resolve: (cursor: Cursor | undefined) => void;
}

export class StreamCoordinator extends DurableObject<Env> {
  private readonly waiters = new Set<CursorWaiter>();

  load(): Promise<SerializedCoordinatorStoreRecord | undefined> {
    return this.ctx.storage.get<SerializedCoordinatorStoreRecord>(RECORD_KEY);
  }

  async save(
    options: SaveSerializedCoordinatorStoreOptions
  ): Promise<SerializedCoordinatorStoreSave> {
    const current =
      await this.ctx.storage.get<SerializedCoordinatorStoreRecord>(RECORD_KEY);

    if (current === undefined && options.expectedEtag !== undefined) {
      return { status: "conflict" };
    }
    if (current !== undefined && options.expectedEtag === undefined) {
      return { current, status: "conflict" };
    }
    if (current !== undefined && current.etag !== options.expectedEtag) {
      return { current, status: "conflict" };
    }

    await this.ctx.storage.put(RECORD_KEY, options.record);
    this.notifyWaiters(options.record);

    return { status: "saved" };
  }

  async waitForCursor(timeoutMs: number): Promise<Cursor | undefined> {
    return await new Promise<Cursor | undefined>((resolve) => {
      const waiter: CursorWaiter = { resolve };
      this.waiters.add(waiter);

      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        resolve(undefined);
      }, timeoutMs);

      waiter.resolve = (cursor) => {
        clearTimeout(timer);
        this.waiters.delete(waiter);
        resolve(cursor);
      };
    });
  }

  private notifyWaiters(record: SerializedCoordinatorStoreRecord): void {
    if (this.waiters.size === 0) {
      return;
    }

    const cursor = cursorFromRecord(record);

    if (cursor === undefined) {
      return;
    }

    for (const waiter of [...this.waiters]) {
      waiter.resolve(cursor);
    }
  }
}

function cursorFromRecord(
  record: SerializedCoordinatorStoreRecord
): Cursor | undefined {
  try {
    return parseCoordinatorPipelineSnapshot(record.snapshot).state.cursor;
  } catch {
    return;
  }
}
