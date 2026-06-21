import { assertNonNegativeSafeInteger } from "../validation/ids";
import type {
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineStore,
  SaveCoordinatorPipelineOptions,
} from "./coordinator";
import {
  cloneCoordinatorPipelineSnapshot,
  cloneCoordinatorPipelineState,
} from "./coordinator-snapshot";

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
        etag: nextEtag(current),
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

function nextEtag(current: CoordinatorPipelineSnapshot | undefined): string {
  if (current === undefined) {
    return "1";
  }

  const value = Number(current.etag);

  assertNonNegativeSafeInteger(value, "coordinator pipeline etag");

  return String(value + 1);
}
