import { describe, expect, test } from "bun:test";
import { assertCoordinatorPipelineStoreConformance } from "../conformance";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import { createCoordinatorPipeline, issueCoordinatorSlot } from "./coordinator";
import {
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
  const records = new Map<string, SerializedCoordinatorStoreRecord>();

  return {
    load(sessionId) {
      return Promise.resolve(records.get(sessionId));
    },
    records,
    save(options) {
      const current = records.get(options.sessionId);

      if (
        current !== undefined &&
        options.expectedEtag !== undefined &&
        current.etag !== options.expectedEtag
      ) {
        return Promise.resolve({
          current,
          status: "conflict",
        });
      }

      records.set(options.sessionId, options.record);
      return Promise.resolve({ status: "saved" });
    },
  };
}
