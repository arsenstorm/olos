import { describe, expect, test } from "bun:test";
import type {
  HeadObjectCommand,
  HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import {
  createCoordinatorPipeline,
  createMemoryCoordinatorStore,
  issueCoordinatorSlot,
} from "../protocol";
import type { CoordinatorPipelineState } from "../protocol/coordinator";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import type { S3HeadObjectClient } from "./object-observation";
import {
  planStoredS3CoordinatorReconciliation,
  reconcileStoredS3CoordinatorUploads,
} from "./reconciliation";

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

describe("stored S3 upload reconciliation", () => {
  test("plans in-flight S3 slots for app-owned recovery jobs", async () => {
    const store = createMemoryCoordinatorStore();

    await store.save({
      sessionId: session.sessionId,
      state: stateWithSlots(),
    });

    const plan = await planStoredS3CoordinatorReconciliation({
      sessionId: session.sessionId,
      slotIds: ["slot_3810"],
      store,
    });

    expect(plan.status).toBe("planned");
    if (plan.status !== "planned") {
      throw new Error("expected reconciliation plan");
    }

    expect(plan.slotIds).toEqual(["slot_3810"]);
    expect(plan.slots).toHaveLength(1);
    expect(plan.slots[0]?.objectKey).toBe("media/v1080/3810.m4s");
  });

  test("commits existing S3 objects for issued slots", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();

    await store.save({
      sessionId: session.sessionId,
      state: stateWithSlots(),
    });

    const result = await reconcileStoredS3CoordinatorUploads({
      bucket: "media",
      client: clientFor(
        new Map([
          ["media/v1080/init.mp4", 1024],
          ["media/v1080/3810.m4s", 98_304],
        ]),
        headObjectInputs
      ),
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: (slot) => slot.kind === "segment",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store,
    });
    const snapshot = await store.load(session.sessionId);

    expect(result.status).toBe("reconciled");
    if (result.status !== "reconciled") {
      throw new Error("expected reconciliation result");
    }

    expect(result.results.map((entry) => entry.status)).toEqual([
      "committed",
      "committed",
    ]);
    expect(snapshot?.state.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/v1080/init.mp4",
      },
      {
        Bucket: "media",
        Key: "media/v1080/3810.m4s",
      },
    ]);
  });

  test("reports failed slots without stopping reconciliation", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();

    await store.save({
      sessionId: session.sessionId,
      state: stateWithSlots(),
    });

    const result = await reconcileStoredS3CoordinatorUploads({
      bucket: "media",
      client: clientFor(
        new Map([["media/v1080/init.mp4", 1024]]),
        headObjectInputs
      ),
      committedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("reconciled");
    if (result.status !== "reconciled") {
      throw new Error("expected reconciliation result");
    }

    expect(result.results.map((entry) => entry.status)).toEqual([
      "committed",
      "failed",
    ]);
    expect(result.results[1]).toMatchObject({
      error: "missing object: media/v1080/3810.m4s",
      status: "failed",
    });
  });
});

function stateWithSlots(): CoordinatorPipelineState {
  let state = createCoordinatorPipeline({ pathways, session });

  state = issueCoordinatorSlot({
    contentType: "video/mp4",
    deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
    duration: 1,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: "init",
    maxBytes: 2048,
    mediaSequenceNumber: 0,
    objectKey: "media/v1080/init.mp4",
    publicationMode: "direct-public",
    publisherInstanceId: "publisher_1",
    renditionId: "v1080",
    slotId: "slot_init",
    state,
  }).state;

  return issueCoordinatorSlot({
    contentType: "video/mp4",
    deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
    duration: 2,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: "segment",
    maxBytes: 100_000,
    mediaSequenceNumber: 3810,
    objectKey: "media/v1080/3810.m4s",
    publicationMode: "direct-public",
    publisherInstanceId: "publisher_1",
    renditionId: "v1080",
    slotId: "slot_3810",
    state,
  }).state;
}

function clientFor(
  objects: ReadonlyMap<string, number>,
  inputs: unknown[]
): S3HeadObjectClient {
  return {
    send(command: HeadObjectCommand): Promise<HeadObjectCommandOutput> {
      inputs.push(command.input);

      const objectKey = String(command.input.Key);
      const size = objects.get(objectKey);

      if (size === undefined) {
        return Promise.reject(new Error(`missing object: ${objectKey}`));
      }

      return Promise.resolve({
        $metadata: {},
        ContentLength: size,
        ContentType: "video/mp4",
        ETag: `"${objectKey}"`,
        LastModified: new Date("2026-01-01T00:00:01.000Z"),
      });
    },
  };
}
