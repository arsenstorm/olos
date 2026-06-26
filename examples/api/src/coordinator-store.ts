import type {
  SaveSerializedCoordinatorStoreOptions,
  SerializedCoordinatorStoreBackend,
  SerializedCoordinatorStoreRecord,
  SerializedCoordinatorStoreSave,
} from "olos/protocol";
import type { StreamCoordinator } from "./coordinator-do";

export function createCoordinatorStoreBackend(
  namespace: DurableObjectNamespace<StreamCoordinator>
): SerializedCoordinatorStoreBackend {
  return {
    load(
      sessionId: string
    ): Promise<SerializedCoordinatorStoreRecord | undefined> {
      return stubFor(namespace, sessionId).load();
    },
    save(
      options: SaveSerializedCoordinatorStoreOptions
    ): Promise<SerializedCoordinatorStoreSave> {
      return stubFor(namespace, options.sessionId).save(options);
    },
  };
}

function stubFor(
  namespace: DurableObjectNamespace<StreamCoordinator>,
  sessionId: string
): DurableObjectStub<StreamCoordinator> {
  return namespace.get(namespace.idFromName(sessionId));
}
