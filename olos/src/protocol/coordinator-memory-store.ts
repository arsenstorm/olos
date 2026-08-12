import {
  cloneCoordinatorPipelineSnapshot,
  cloneCoordinatorPipelineState,
  createNextCoordinatorPipelineEtag,
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

      return Promise.resolve(
        snapshot === undefined ? undefined : cloneCursorView(snapshot)
      );
    },
    save(options: SaveCoordinatorPipelineOptions) {
      return Promise.resolve(saveIntoEntries(entries, options));
    },
  };
}

function saveIntoEntries(
  entries: Map<string, CoordinatorPipelineSnapshot>,
  options: SaveCoordinatorPipelineOptions
) {
  const current = entries.get(options.sessionId);
  const conflict = resolveSaveConflict(current, options.expectedEtag);

  if (conflict !== undefined) {
    return conflict;
  }

  const snapshot = {
    etag: createNextCoordinatorPipelineEtag(current?.etag),
    state: cloneCoordinatorPipelineState(options.state),
  };
  entries.set(options.sessionId, snapshot);

  return {
    etag: snapshot.etag,
    state: cloneCoordinatorPipelineState(snapshot.state),
    status: "saved" as const,
  };
}

/**
 * Optimistic concurrency: a save must present the stored etag, and a first
 * save must present none. Returns the conflict to report, or `undefined`
 * when the save may proceed.
 */
function resolveSaveConflict(
  current: CoordinatorPipelineSnapshot | undefined,
  expectedEtag: string | undefined
) {
  if (current === undefined) {
    return expectedEtag === undefined
      ? undefined
      : conflictingCoordinatorStoreSave();
  }

  // A missing expectedEtag never equals a stored one, so this covers both
  // the stale-etag and the missing-etag-against-existing-session cases.
  return current.etag === expectedEtag
    ? undefined
    : conflictingCoordinatorStoreSave(
        cloneCoordinatorPipelineSnapshot(current)
      );
}

// Clone only the projected fields (session and cursor, at the same depth
// `cloneCoordinatorPipelineState` uses) so the returned view never aliases
// the stored snapshot without deep-cloning slots and commits it discards.
function cloneCursorView(
  snapshot: CoordinatorPipelineSnapshot
): CoordinatorCursorView {
  const { cursor, session } = snapshot.state;

  return {
    ...(cursor === undefined ? {} : { cursor: { ...cursor } }),
    etag: snapshot.etag,
    session: {
      ...session,
      renditions: session.renditions.map((rendition) => ({ ...rendition })),
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
