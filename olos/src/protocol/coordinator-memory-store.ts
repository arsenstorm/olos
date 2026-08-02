import {
  cloneCoordinatorPipelineSnapshot,
  cloneCoordinatorPipelineState,
  createNextCoordinatorPipelineEtag,
  cursorViewFromSnapshot,
} from "./coordinator-snapshot";
import type {
  CoordinatorCursorView,
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineStore,
  SaveCoordinatorPipelineOptions,
} from "./coordinator-types";

/**
 * Create an in-memory `CoordinatorPipelineStore` for tests and single-process
 * runtimes. Nothing is persisted beyond the returned store's lifetime.
 *
 * Implements the full store contract: monotonically increasing numeric
 * etags, the `loadCursor` fast path, and etag-checked saves — omitting
 * `expectedEtag` inserts (conflicting when the session already exists),
 * providing it updates (conflicting on mismatch or a missing record, with
 * the current snapshot attached when one exists). Loads and saves deep-clone
 * state so callers can never alias the stored snapshot.
 */
export function createMemoryCoordinatorStore(): CoordinatorPipelineStore {
  const entries = new Map<string, CoordinatorPipelineSnapshot>();

  return {
    load(sessionId) {
      const snapshot = entries.get(sessionId);

      return Promise.resolve(
        snapshot === undefined
          ? undefined
          : cloneCoordinatorPipelineSnapshot(snapshot)
      );
    },
    loadCursor(sessionId): Promise<CoordinatorCursorView | undefined> {
      const snapshot = entries.get(sessionId);

      // Clone before projecting so the returned view never aliases the
      // stored snapshot (cursorViewFromSnapshot copies references).
      return Promise.resolve(
        snapshot === undefined
          ? undefined
          : cursorViewFromSnapshot(cloneCoordinatorPipelineSnapshot(snapshot))
      );
    },
    save(options: SaveCoordinatorPipelineOptions) {
      const current = entries.get(options.sessionId);

      if (current === undefined && options.expectedEtag !== undefined) {
        return Promise.resolve(conflictingCoordinatorStoreSave());
      }

      if (current !== undefined && options.expectedEtag === undefined) {
        return Promise.resolve(
          conflictingCoordinatorStoreSave(
            cloneCoordinatorPipelineSnapshot(current)
          )
        );
      }

      if (current !== undefined && current.etag !== options.expectedEtag) {
        return Promise.resolve(
          conflictingCoordinatorStoreSave(
            cloneCoordinatorPipelineSnapshot(current)
          )
        );
      }

      const snapshot = {
        etag: createNextCoordinatorPipelineEtag(current?.etag),
        state: cloneCoordinatorPipelineState(options.state),
      };
      entries.set(options.sessionId, snapshot);

      return Promise.resolve({
        etag: snapshot.etag,
        state: cloneCoordinatorPipelineState(snapshot.state),
        status: "saved" as const,
      });
    },
  };
}

function conflictingCoordinatorStoreSave(
  current?: CoordinatorPipelineSnapshot
): {
  current?: CoordinatorPipelineSnapshot;
  status: "conflict";
} {
  return {
    ...(current === undefined ? {} : { current }),
    status: "conflict",
  };
}
