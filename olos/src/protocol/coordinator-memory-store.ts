import type { CoordinatorPipelineStore } from "./coordinator-types";
import {
  createMemorySerializedCoordinatorStoreBackend,
  createSerializedCoordinatorStore,
} from "./serialized-store";

/**
 * Create an in-memory `CoordinatorPipelineStore` for tests and single-process
 * runtimes. Nothing is persisted beyond the returned store's lifetime.
 */
export function createMemoryCoordinatorStore(): CoordinatorPipelineStore {
  return createSerializedCoordinatorStore(
    createMemorySerializedCoordinatorStoreBackend()
  );
}
