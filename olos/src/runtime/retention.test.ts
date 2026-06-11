import { describe, expect, test } from "bun:test";

import {
  commitCoordinatorUpload,
  createCoordinatorPipeline,
  createMemoryCoordinatorStore,
  issueCoordinatorSlot,
} from "../protocol";
import type { CoordinatorPipelineState } from "../protocol/coordinator";
import { createObservedUpload } from "../state/observed-upload";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import {
  deleteRetiredCoordinatorObjects,
  planStoredCoordinatorRetention,
} from "./retention";

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

describe("stored runtime retention", () => {
  test("plans app-owned retention work from stored coordinator state", async () => {
    const store = createMemoryCoordinatorStore();
    const saved = await store.save({
      sessionId: session.sessionId,
      state: retentionState(),
    });

    if (saved.status !== "saved") {
      throw new Error("expected stored coordinator state");
    }

    const result = await planStoredCoordinatorRetention({
      now: "2026-01-01T00:00:06.000Z",
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("planned");

    if (result.status !== "planned") {
      throw new Error("expected retention plan");
    }

    expect(result.response.status).toBe(200);
    expect(result.plan.expiredSlots.map((slot) => slot.slotId)).toEqual([
      "slot_3813",
    ]);
    expect(result.plan.retiredObjects).toEqual([
      {
        commitId: "commit_3810",
        objectKey: "media/s3810.m4s",
        slotId: "slot_3810",
      },
    ]);
    expect(await result.response.json()).toEqual({ plan: result.plan });
  });

  test("returns not found for missing stored retention state", async () => {
    const result = await planStoredCoordinatorRetention({
      now: "2026-01-01T00:00:06.000Z",
      sessionId: "missing",
      store: createMemoryCoordinatorStore(),
    });

    expect(result.status).toBe("not_found");
    expect(result.response.status).toBe(404);
  });

  test("deletes retired coordinator objects through an app-owned callback", async () => {
    const deleted: string[] = [];
    const result = await deleteRetiredCoordinatorObjects({
      deleteObject: (object) => {
        deleted.push(object.objectKey);
      },
      objects: [
        {
          commitId: "commit_3810",
          objectKey: "media/s3810.m4s",
          slotId: "slot_3810",
        },
      ],
    });

    expect(deleted).toEqual(["media/s3810.m4s"]);
    expect(result).toEqual({
      deletedObjects: [
        {
          commitId: "commit_3810",
          objectKey: "media/s3810.m4s",
          slotId: "slot_3810",
        },
      ],
      failedObjects: [],
    });
  });

  test("keeps deleting retired coordinator objects after a failure", async () => {
    const result = await deleteRetiredCoordinatorObjects({
      deleteObject: (object) => {
        if (object.objectKey === "media/fail.m4s") {
          throw new Error("delete failed");
        }
      },
      objects: [
        {
          commitId: "commit_fail",
          objectKey: "media/fail.m4s",
          slotId: "slot_fail",
        },
        {
          commitId: "commit_ok",
          objectKey: "media/ok.m4s",
          slotId: "slot_ok",
        },
      ],
    });

    expect(result.deletedObjects).toEqual([
      {
        commitId: "commit_ok",
        objectKey: "media/ok.m4s",
        slotId: "slot_ok",
      },
    ]);
    expect(result.failedObjects).toEqual([
      {
        error: "delete failed",
        object: {
          commitId: "commit_fail",
          objectKey: "media/fail.m4s",
          slotId: "slot_fail",
        },
      },
    ]);
  });
});

function retentionState(): CoordinatorPipelineState {
  let state = createCoordinatorPipeline({ pathways, session });

  state = commitSlot(state, {
    commitId: "commit_init",
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
    commitId: "commit_3811",
    deliveryUrl: "https://media.example.com/s3811.m4s",
    duration: 2,
    independent: true,
    maxBytes: 100_000,
    mediaSequenceNumber: 3811,
    objectKey: "media/s3811.m4s",
    slotId: "slot_3811",
    size: 98_304,
  });
  state = commitSlot(state, {
    commitId: "commit_3812",
    deliveryUrl: "https://media.example.com/s3812.m4s",
    duration: 2,
    independent: true,
    maxBytes: 100_000,
    maxSegments: 2,
    mediaSequenceNumber: 3812,
    objectKey: "media/s3812.m4s",
    slotId: "slot_3812",
    size: 98_304,
  });

  return issueCoordinatorSlot({
    contentType: "video/mp4",
    deliveryUrl: "https://media.example.com/s3813.m4s",
    duration: 2,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: "segment",
    maxBytes: 100_000,
    mediaSequenceNumber: 3813,
    objectKey: "media/s3813.m4s",
    publicationMode: "direct-public",
    publisherInstanceId: "pub_1",
    renditionId: "v1080",
    slotId: "slot_3813",
    state,
  }).state;
}

interface CommitSlotOptions {
  commitId: string;
  deliveryUrl: string;
  duration: number;
  independent?: boolean;
  maxBytes: number;
  maxSegments?: number;
  mediaSequenceNumber: number;
  objectKey: string;
  size: number;
  slotId: string;
}

function commitSlot(
  state: CoordinatorPipelineState,
  options: CommitSlotOptions
): CoordinatorPipelineState {
  const issued = issueCoordinatorSlot({
    contentType: "video/mp4",
    deliveryUrl: options.deliveryUrl,
    duration: options.duration,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: options.slotId === "slot_init" ? "init" : "segment",
    maxBytes: options.maxBytes,
    mediaSequenceNumber: options.mediaSequenceNumber,
    objectKey: options.objectKey,
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
    maxSegments: options.maxSegments,
    object: createObservedUpload({
      contentType: "video/mp4",
      objectKey: options.objectKey,
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      size: options.size,
    }),
    slotId: options.slotId,
    state: issued.state,
  });

  if (committed.status !== "committed") {
    throw new Error("expected committed upload");
  }

  return committed.state;
}
