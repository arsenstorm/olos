import { describe, expect, test } from "bun:test";
import { assertCoordinatorPipelineStoreConformance } from "../conformance";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import { createCoordinatorPipeline, issueCoordinatorSlot } from "./coordinator";
import {
  assertSerializedCoordinatorStoreBackendConformance,
  createMemorySerializedCoordinatorStoreBackend,
  createSerializedCoordinatorStore,
  type SerializedCoordinatorStoreBackend,
  type SerializedCoordinatorStoreRecord,
} from "./serialized-store";

const session: Session = {
  createdAt: "2026-01-01T00:00:00.000Z",
  epoch: 1,
  latencyProfile: "object-ll",
  olos: "1.0",
  partTarget: 0.5,
  renditions: [
    {
      bitrate: 5_000_000,
      codec: "avc1.640028",
      frameRate: 30,
      height: 1080,
      kind: "video",
      renditionId: "v1080",
      width: 1920,
    },
  ],
  segmentTarget: 2,
  sessionId: "session_1",
  state: "live",
  tenantId: "tenant_1",
};

const pathways: Pathway[] = [
  {
    baseUrl: "https://media.example.com",
    pathwayId: "primary",
    priority: 0,
    providerId: "s3_primary",
    state: "active",
  },
];

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

  test("stores JSON snapshots with monotonic etags", async () => {
    const backend = createBackend();
    const store = createSerializedCoordinatorStore(backend);
    const state = createCoordinatorPipeline({ pathways, session });
    const first = await store.save({
      sessionId: session.sessionId,
      state,
    });

    if (first.status !== "saved") {
      throw new Error("expected first save");
    }

    const next = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/init.mp4",
      duration: 1,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "init",
      maxBytes: 2048,
      mediaSequenceNumber: 0,
      objectKey: "media/init.mp4",
      publicationMode: "direct-public",
      publisherInstanceId: "publisher_1",
      renditionId: "v1080",
      slotId: "slot_init",
      state,
    });
    const second = await store.save({
      expectedEtag: first.etag,
      sessionId: session.sessionId,
      state: next.state,
    });

    if (second.status !== "saved") {
      throw new Error("expected second save");
    }

    const record = await backend.load(session.sessionId);

    expect(second.etag).toBe("2");
    expect(record?.etag).toBe("2");
    expect(record?.snapshot).toContain('"slotId":"slot_init"');
  });

  test("returns the current snapshot when an insert races an existing row", async () => {
    const backend = createBackend();
    const store = createSerializedCoordinatorStore(backend);
    const state = createCoordinatorPipeline({ pathways, session });
    const first = await store.save({
      sessionId: session.sessionId,
      state,
    });
    const raced = await store.save({
      sessionId: session.sessionId,
      state,
    });

    if (first.status !== "saved") {
      throw new Error("expected first save");
    }

    expect(raced.status).toBe("conflict");
    if (raced.status !== "conflict") {
      throw new Error("expected raced insert conflict");
    }

    expect(raced.current?.etag).toBe(first.etag);
    expect(raced.current?.state.session.sessionId).toBe(session.sessionId);
  });

  test("rejects serialized records with mismatched etags", async () => {
    const backend = createBackend();
    const store = createSerializedCoordinatorStore(backend);
    const state = createCoordinatorPipeline({ pathways, session });
    const saved = await store.save({
      sessionId: session.sessionId,
      state,
    });

    if (saved.status !== "saved") {
      throw new Error("expected saved state");
    }

    backend.records.set(session.sessionId, {
      etag: "different",
      snapshot: backend.records.get(session.sessionId)?.snapshot ?? "",
    });

    await expect(store.load(session.sessionId)).rejects.toThrow(
      "serialized coordinator record etag must match snapshot"
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
