import { describe, expect, test } from "bun:test";
import { renderMediaPlaylist } from "../hls/media-playlist";
import { createObservedUpload } from "../state/observed-upload";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import {
  type CoordinatorPipelineState,
  commitCoordinatorUpload,
  createCoordinatorPipeline,
  createMemoryCoordinatorStore,
  issueCoordinatorSlot,
  mutateCoordinatorPipeline,
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

  test("mutates stored coordinator state", async () => {
    const store = createMemoryCoordinatorStore();
    const state = createCoordinatorPipeline({ pathways, session });
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const result = await mutateCoordinatorPipeline({
      mutate: (current) =>
        issueCoordinatorSlot({
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
          state: current,
        }).state,
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("saved");
    if (result.status !== "saved") {
      throw new Error("expected saved mutation");
    }

    expect(result.etag).toBe("2");
    expect(result.state.slots).toHaveLength(1);
  });

  test("does not mutate missing coordinator sessions", async () => {
    const store = createMemoryCoordinatorStore();
    const result = await mutateCoordinatorPipeline({
      mutate: (state) => state,
      sessionId: "missing_session",
      store,
    });

    expect(result).toEqual({ status: "not_found" });
  });

  test("retries coordinator store conflicts with the latest state", async () => {
    const store = createMemoryCoordinatorStore();
    const state = createCoordinatorPipeline({ pathways, session });
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    let attempts = 0;
    const result = await mutateCoordinatorPipeline({
      mutate: async (current) => {
        attempts += 1;

        if (attempts === 1) {
          await store.save({
            sessionId: session.sessionId,
            state: {
              ...current,
              slots: [
                ...current.slots,
                issueCoordinatorSlot({
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
                  state: current,
                }).slot,
              ],
            },
          });
        }

        return issueCoordinatorSlot({
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
          state: current,
        }).state;
      },
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("saved");
    if (result.status !== "saved") {
      throw new Error("expected saved retry");
    }

    expect(attempts).toBe(2);
    expect(result.state.slots.map((slot) => slot.slotId)).toEqual([
      "slot_init",
      "slot_3810",
    ]);
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

  test("publishes low-latency parts before the full segment is committed", () => {
    let state = createCoordinatorPipeline({ pathways, session });

    state = commitSlot(state, {
      commitId: "commit_init",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/init.mp4",
      duration: 1,
      maxBytes: 2048,
      mediaSequenceNumber: 0,
      objectKey: "media/init.mp4",
      slotId: "slot_init",
      size: 1024,
    });
    state = commitSlot(state, {
      commitId: "commit_3810",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/s3810.m4s",
      duration: 2,
      independent: true,
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKey: "media/s3810.m4s",
      slotId: "slot_3810",
      size: 98_304,
    });
    state = commitSlot(state, {
      commitId: "commit_3811_0",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/s3811.p0.m4s",
      duration: 0.5,
      independent: true,
      maxBytes: 25_000,
      mediaSequenceNumber: 3811,
      objectKey: "media/s3811.p0.m4s",
      partNumber: 0,
      slotId: "slot_3811_0",
      size: 24_000,
    });
    state = commitSlot(state, {
      commitId: "commit_3811_1",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/s3811.p1.m4s",
      duration: 0.5,
      maxBytes: 25_000,
      mediaSequenceNumber: 3811,
      objectKey: "media/s3811.p1.m4s",
      partNumber: 1,
      slotId: "slot_3811_1",
      size: 24_000,
    });

    const cursor = state.cursor;

    if (cursor === undefined) {
      throw new Error("expected low-latency cursor");
    }

    expect(cursor.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3811,
      lastPartNumber: 1,
    });

    const playlist = renderMediaPlaylist(cursor.committedWindow, {
      allowedMediaOrigins: ["https://media.example.com"],
      partTarget: session.partTarget,
      renditionId: "v1080",
      segmentTarget: session.segmentTarget,
      targetLatency: 3,
    });

    expect(playlist).toContain("#EXT-X-PART-INF:PART-TARGET=0.500");
    expect(playlist).toContain(
      '#EXT-X-PART:DURATION=0.500,INDEPENDENT=YES,URI="https://media.example.com/s3811.p0.m4s"'
    );
    expect(playlist).toContain(
      '#EXT-X-PART:DURATION=0.500,URI="https://media.example.com/s3811.p1.m4s"'
    );
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

interface CommitSlotOptions {
  commitId: string;
  contentType: string;
  deliveryUrl: string;
  duration: number;
  independent?: boolean;
  maxBytes: number;
  mediaSequenceNumber: number;
  objectKey: string;
  partNumber?: number;
  size: number;
  slotId: string;
}

function commitSlot(
  state: CoordinatorPipelineState,
  options: CommitSlotOptions
): CoordinatorPipelineState {
  const issued = issueCoordinatorSlot({
    contentType: options.contentType,
    deliveryUrl: options.deliveryUrl,
    duration: options.duration,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: options.slotId === "slot_init" ? "init" : "segment",
    maxBytes: options.maxBytes,
    mediaSequenceNumber: options.mediaSequenceNumber,
    objectKey: options.objectKey,
    partNumber: options.partNumber,
    publicationMode: "direct-public",
    publisherInstanceId: "pub_1",
    renditionId: "v1080",
    slotId: options.slotId,
    state,
  });
  const committed = commitCoordinatorUpload({
    commitId: options.commitId,
    committedAt: "2026-01-01T00:00:02.000Z",
    independent: options.independent,
    object: createObservedUpload({
      contentType: options.contentType,
      objectKey: options.objectKey,
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      size: options.size,
    }),
    slotId: options.slotId,
    state: issued.state,
  });

  if (committed.status !== "committed") {
    throw new Error("expected committed slot");
  }

  return committed.state;
}
