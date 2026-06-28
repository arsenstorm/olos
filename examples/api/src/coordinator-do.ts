import { DurableObject } from "cloudflare:workers";
import type {
  SaveSerializedCoordinatorStoreOptions,
  SerializedCoordinatorStoreRecord,
  SerializedCoordinatorStoreSave,
  SerializedCursorViewRecord,
} from "@arsenstorm/olos/protocol";
import { parseCoordinatorPipelineSnapshot } from "@arsenstorm/olos/protocol";
import type { Cursor, Session } from "@arsenstorm/olos/types";

// Two persisted keys. CURSOR_KEY holds the minimum the manifest renderer
// needs (cursor + session, ~1–2 KB after the 0.5.0 retention work); the
// manifest GET hot path reads only this key so per-request CPU stays
// sub-millisecond on Workers Free. RECORD_KEY holds the full snapshot for
// mutating routes (commit, slot, reconcile).
const RECORD_KEY = "coordinator-record";
const CURSOR_KEY = "cursor-record";

interface CursorWaiter {
  resolve: (cursor: Cursor | undefined) => void;
}

export class StreamCoordinator extends DurableObject<Env> {
  private readonly waiters = new Set<CursorWaiter>();

  load(): Promise<SerializedCoordinatorStoreRecord | undefined> {
    return this.ctx.storage.get<SerializedCoordinatorStoreRecord>(RECORD_KEY);
  }

  async loadCursorView(): Promise<SerializedCursorViewRecord | undefined> {
    const view =
      await this.ctx.storage.get<SerializedCursorViewRecord>(CURSOR_KEY);
    if (view !== undefined) {
      return view;
    }

    // Legacy fallback for sessions persisted before 0.5.0: derive the cursor
    // view from the full record. Pays the snapshot-parse cost once; the next
    // save writes CURSOR_KEY and subsequent loads hit the fast path.
    const record =
      await this.ctx.storage.get<SerializedCoordinatorStoreRecord>(RECORD_KEY);
    return record === undefined ? undefined : cursorViewFromRecord(record);
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

    const writes: Record<string, unknown> = { [RECORD_KEY]: options.record };
    if (options.cursorView !== undefined) {
      writes[CURSOR_KEY] = options.cursorView;
    }
    await this.ctx.storage.put(writes);

    if (options.cursorView !== undefined) {
      this.notifyWaiters(options.cursorView);
    }

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

  private notifyWaiters(view: SerializedCursorViewRecord): void {
    if (this.waiters.size === 0) {
      return;
    }

    const cursor = cursorFromView(view);
    if (cursor === undefined) {
      return;
    }

    for (const waiter of [...this.waiters]) {
      waiter.resolve(cursor);
    }
  }
}

function cursorFromView(view: SerializedCursorViewRecord): Cursor | undefined {
  try {
    const parsed = JSON.parse(view.view) as { cursor?: Cursor };
    return parsed.cursor;
  } catch {
    return;
  }
}

function cursorViewFromRecord(
  record: SerializedCoordinatorStoreRecord
): SerializedCursorViewRecord | undefined {
  try {
    const snapshot = parseCoordinatorPipelineSnapshot(record.snapshot);
    const view: { cursor?: Cursor; session: Session } = {
      ...(snapshot.state.cursor === undefined
        ? {}
        : { cursor: snapshot.state.cursor }),
      session: snapshot.state.session,
    };
    return { etag: record.etag, view: JSON.stringify(view) };
  } catch {
    return;
  }
}
