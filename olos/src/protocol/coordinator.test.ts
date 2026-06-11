import { describe, expect, test } from "bun:test";
import { createObservedUpload } from "../state/observed-upload";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import {
  commitCoordinatorUpload,
  createCoordinatorPipeline,
  createMemoryCoordinatorStore,
  issueCoordinatorSlot,
} from "./coordinator";

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

describe("coordinator pipeline", () => {
  test("saves and loads coordinator state snapshots", async () => {
    const store = createMemoryCoordinatorStore();
    const state = createCoordinatorPipeline({ pathways, session });
    const saved = await store.save({
      sessionId: session.sessionId,
      state,
    });

    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") {
      throw new Error("expected saved state");
    }

    const loaded = await store.load(session.sessionId);

    expect(saved.etag).toBe("1");
    expect(loaded).toEqual({
      etag: saved.etag,
      state: saved.state,
    });
  });

  test("rejects stale coordinator state writes", async () => {
    const store = createMemoryCoordinatorStore();
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
      publisherInstanceId: "pub_1",
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

    const stale = await store.save({
      expectedEtag: first.etag,
      sessionId: session.sessionId,
      state,
    });

    expect(second.etag).toBe("2");
    expect(stale.status).toBe("conflict");
    if (stale.status !== "conflict") {
      throw new Error("expected stale write conflict");
    }

    expect(stale.current?.etag).toBe("2");
    expect(stale.current?.state.slots).toHaveLength(1);
  });

  test("returns independent coordinator state snapshots", async () => {
    const store = createMemoryCoordinatorStore();
    const state = createCoordinatorPipeline({ pathways, session });
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const first = await store.load(session.sessionId);
    const second = await store.load(session.sessionId);

    if (first === undefined || second === undefined) {
      throw new Error("expected stored state");
    }

    expect(first.state).not.toBe(second.state);
    expect(first.state.session).not.toBe(second.state.session);
    expect(first.state.pathways).not.toBe(second.state.pathways);
  });

  test("issues slots, commits verified uploads, and advances trusted state", () => {
    let state = createCoordinatorPipeline({ pathways, session });

    const initIssue = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/init.mp4",
      duration: 1,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "init",
      maxBytes: 2048,
      mediaSequenceNumber: 0,
      objectKey: "media/init.mp4",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_init",
      state,
    });
    state = initIssue.state;

    const initCommit = commitCoordinatorUpload({
      commitId: "commit_init",
      committedAt: "2026-01-01T00:00:01.000Z",
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: "media/init.mp4",
        observedAt: "2026-01-01T00:00:01.000Z",
        providerId: "s3_primary",
        size: 1024,
      }),
      slotId: "slot_init",
      state,
    });

    if (initCommit.status !== "committed") {
      throw new Error("expected init commit");
    }

    expect(initCommit.cursor).toBeUndefined();
    state = initCommit.state;

    const segmentIssue = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/s3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKey: "media/s3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_3810",
      state,
    });
    state = segmentIssue.state;

    const segmentCommit = commitCoordinatorUpload({
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: true,
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: "media/s3810.m4s",
        observedAt: "2026-01-01T00:00:02.000Z",
        providerId: "s3_primary",
        size: 98_304,
      }),
      slotId: "slot_3810",
      state,
    });

    if (segmentCommit.status !== "committed") {
      throw new Error("expected segment commit");
    }

    expect(segmentCommit.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(segmentCommit.state.commits).toHaveLength(1);
    expect(segmentCommit.state.initCommits).toHaveLength(1);
    expect(segmentCommit.state.slots.at(-1)?.state).toBe("committed");

    const duplicateCommit = commitCoordinatorUpload({
      commitId: "commit_3810_retry",
      committedAt: "2026-01-01T00:00:02.500Z",
      independent: true,
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: "media/s3810.m4s",
        observedAt: "2026-01-01T00:00:02.000Z",
        providerId: "s3_primary",
        size: 98_304,
      }),
      slotId: "slot_3810",
      state: segmentCommit.state,
    });

    expect(duplicateCommit.status).toBe("idempotent");
    expect(duplicateCommit.state.commits).toHaveLength(1);
  });

  test("rejects uploads for unknown slots", () => {
    const state = createCoordinatorPipeline({ pathways, session });
    const result = commitCoordinatorUpload({
      commitId: "commit_unknown",
      committedAt: "2026-01-01T00:00:02.000Z",
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: "media/unknown.m4s",
        observedAt: "2026-01-01T00:00:02.000Z",
        providerId: "s3_primary",
        size: 98_304,
      }),
      slotId: "slot_unknown",
      state,
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected rejected upload");
    }

    expect(result.error.error.code).toBe("olos.unknown_slot");
  });
});
