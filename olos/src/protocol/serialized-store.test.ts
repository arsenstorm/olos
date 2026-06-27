import { describe, expect, test } from "bun:test";
import { assertCoordinatorPipelineStoreConformance } from "../conformance";
import { issueCoordinatorSlot } from "./coordinator";
import {
  createCoordinatorStateWithCommittedSegment,
  createEmptyCoordinatorState,
  testCoordinatorSession as session,
} from "./coordinator-state.test-helper";
import {
  assertSerializedCoordinatorStoreBackendConformance,
  createMemorySerializedCoordinatorStoreBackend,
  createSerializedCoordinatorStore,
  type SerializedCoordinatorStoreBackend,
  type SerializedCoordinatorStoreRecord,
} from "./serialized-store";
import {
  conflictingStoreResult,
  savedStoreResult,
} from "./test-store.test-helper";

describe("serialized coordinator store", () => {
  test("adapts serialized snapshot storage to the coordinator store contract", async () => {
    await assertCoordinatorPipelineStoreConformance({
      createStore: () => createSerializedCoordinatorStore(createBackend()),
    });
  });

  test("asserts serialized backend conditional-write conformance", async () => {
    await expect(
      assertSerializedCoordinatorStoreBackendConformance({
        createBackend,
      })
    ).resolves.toBeUndefined();
  });

  test("creates a memory serialized backend with conditional writes", async () => {
    const backend = createMemorySerializedCoordinatorStoreBackend();
    const first = record("1");
    const second = record("2");

    await expect(
      backend.save({ record: first, sessionId: session.sessionId })
    ).resolves.toEqual({ status: "saved" });
    await expect(
      backend.save({ record: first, sessionId: session.sessionId })
    ).resolves.toEqual({ current: first, status: "conflict" });
    await expect(
      backend.save({
        expectedEtag: first.etag,
        record: second,
        sessionId: session.sessionId,
      })
    ).resolves.toEqual({ status: "saved" });
    await expect(backend.load(session.sessionId)).resolves.toEqual(second);
  });

  test("keeps memory serialized backend records isolated", async () => {
    const backend = createMemorySerializedCoordinatorStoreBackend();
    const first = record("1");

    await expect(
      backend.save({ record: first, sessionId: session.sessionId })
    ).resolves.toEqual({ status: "saved" });

    first.etag = "mutated_input";

    const loaded = await backend.load(session.sessionId);

    if (loaded === undefined) {
      throw new Error("expected stored record");
    }

    loaded.etag = "mutated_load";

    const duplicate = await backend.save({
      record: record("2"),
      sessionId: session.sessionId,
    });

    if (duplicate.status !== "conflict" || duplicate.current === undefined) {
      throw new Error("expected duplicate insert conflict");
    }

    duplicate.current.etag = "mutated_conflict";

    await expect(backend.load(session.sessionId)).resolves.toEqual(record("1"));
  });

  test("stores JSON snapshots with monotonic etags", async () => {
    const backend = createBackend();
    const store = createSerializedCoordinatorStore(backend);
    const state = createEmptyCoordinatorState();
    const first = await store.save({
      sessionId: session.sessionId,
      state,
    });

    const firstSave = savedStoreResult(first, "expected first save");

    const next = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/init.mp4",
      duration: 1,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "init",
      maxBytes: 2048,
      mediaSequenceNumber: 0,
      objectKey: "media/init.mp4",
      publisherInstanceId: "publisher_1",
      renditionId: "v1080",
      slotId: "slot_init",
      state,
    });
    const second = await store.save({
      expectedEtag: firstSave.etag,
      sessionId: session.sessionId,
      state: next.state,
    });

    const secondSave = savedStoreResult(second, "expected second save");

    const record = await backend.load(session.sessionId);

    expect(secondSave.etag).toBe("2");
    expect(record?.etag).toBe("2");
    expect(record?.snapshot).toContain('"slotId":"slot_init"');
  });

  test("returns the current snapshot when an insert races an existing row", async () => {
    const backend = createBackend();
    const store = createSerializedCoordinatorStore(backend);
    const state = createEmptyCoordinatorState();
    const first = await store.save({
      sessionId: session.sessionId,
      state,
    });
    const raced = await store.save({
      sessionId: session.sessionId,
      state,
    });

    const firstSave = savedStoreResult(first, "expected first save");

    expect(raced.status).toBe("conflict");
    const racedConflict = conflictingStoreResult(
      raced,
      "expected raced insert conflict"
    );

    expect(racedConflict.current?.etag).toBe(firstSave.etag);
    expect(racedConflict.current?.state.session.sessionId).toBe(
      session.sessionId
    );
  });

  test("returns the current snapshot when an expected-etag update is stale", async () => {
    const backend = createBackend();
    const store = createSerializedCoordinatorStore(backend);
    const state = createEmptyCoordinatorState();
    const first = await store.save({
      sessionId: session.sessionId,
      state,
    });

    const firstSave = savedStoreResult(first, "expected first save");

    const issued = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/init.mp4",
      duration: 1,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "init",
      maxBytes: 2048,
      mediaSequenceNumber: 0,
      objectKey: "media/init.mp4",
      publisherInstanceId: "publisher_1",
      renditionId: "v1080",
      slotId: "slot_init",
      state,
    });
    const second = await store.save({
      expectedEtag: firstSave.etag,
      sessionId: session.sessionId,
      state: issued.state,
    });

    const secondSave = savedStoreResult(second, "expected second save");

    const stale = await store.save({
      expectedEtag: firstSave.etag,
      sessionId: session.sessionId,
      state,
    });

    expect(stale.status).toBe("conflict");
    const staleConflict = conflictingStoreResult(
      stale,
      "expected stale update conflict"
    );

    expect(staleConflict.current?.etag).toBe(secondSave.etag);
    expect(staleConflict.current?.state.slots).toHaveLength(1);
    expect(staleConflict.current?.state.slots[0]?.slotId).toBe("slot_init");
  });

  test("rejects serialized records with mismatched etags", async () => {
    const backend = createBackend();
    const store = createSerializedCoordinatorStore(backend);
    const state = createEmptyCoordinatorState();
    const saved = await store.save({
      sessionId: session.sessionId,
      state,
    });

    savedStoreResult(saved, "expected saved state");

    backend.records.set(session.sessionId, {
      etag: "different",
      snapshot: backend.records.get(session.sessionId)?.snapshot ?? "",
    });

    await expect(store.load(session.sessionId)).rejects.toThrow(
      "serialized coordinator record etag must match snapshot"
    );
  });

  test("rejects serialized records with malformed snapshots", async () => {
    const backend = createBackend();
    const store = createSerializedCoordinatorStore(backend);
    const state = createCoordinatorStateWithCommittedSegment();

    backend.records.set(session.sessionId, {
      etag: "1",
      snapshot: JSON.stringify({
        etag: "1",
        state: {
          ...state,
          cursor: {
            ...state.cursor,
            epoch: 9,
          },
        },
      }),
    });

    await expect(store.load(session.sessionId)).rejects.toThrow(
      "cursor.epoch must match committedWindow.epoch"
    );
  });
});

function createBackend(): SerializedCoordinatorStoreBackend & {
  records: Map<string, SerializedCoordinatorStoreRecord>;
} {
  return createMemorySerializedCoordinatorStoreBackend();
}

function record(etag: string): SerializedCoordinatorStoreRecord {
  return {
    etag,
    snapshot: `{"etag":"${etag}"}`,
  };
}
