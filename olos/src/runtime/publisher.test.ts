import { describe, expect, test } from "bun:test";
import {
  createCoordinatorPipeline,
  createMemoryCoordinatorStore,
} from "../protocol";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import { runRuntimePublisherUploadStep } from "./publisher";
import {
  commitStoredCoordinatorUploadFromRequest,
  issueStoredCoordinatorSlotFromRequest,
} from "./stored";

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

describe("runtime publisher upload step", () => {
  test("issues, uploads, and commits one publisher segment", async () => {
    const store = createMemoryCoordinatorStore();
    await seedSession(store);
    await seedInitUpload(store);

    const step = await runRuntimePublisherUploadStep({
      commit: (request) =>
        commitStoredCoordinatorUploadFromRequest({
          request,
          sessionId: session.sessionId,
          store,
        }),
      committedAt: "2026-01-01T00:00:02.000Z",
      commitId: "commit_3810",
      independent: true,
      issueSlot: (request) =>
        issueStoredCoordinatorSlotFromRequest({
          request,
          sessionId: session.sessionId,
          store,
        }),
      slot: slotPayload({
        deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
        duration: 2,
        kind: "segment",
        maxBytes: 100_000,
        mediaSequenceNumber: 3810,
        objectKey: "media/v1080/3810.m4s",
        slotId: "slot_3810",
      }),
      upload: (slot) =>
        Promise.resolve({
          contentType: slot.contentType,
          objectKey: slot.objectKey,
          observedAt: "2026-01-01T00:00:02.000Z",
          providerId: "s3_primary",
          size: 98_304,
        }),
    });
    const snapshot = await store.load(session.sessionId);

    expect(step.status).toBe("committed");
    expect(snapshot?.state.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
  });

  test("stops before commit when publisher upload fails", async () => {
    const store = createMemoryCoordinatorStore();
    await seedSession(store);

    const step = await runRuntimePublisherUploadStep({
      commit: () => Promise.resolve({ status: "should_not_commit" }),
      committedAt: "2026-01-01T00:00:02.000Z",
      commitId: "commit_3810",
      issueSlot: (request) =>
        issueStoredCoordinatorSlotFromRequest({
          request,
          sessionId: session.sessionId,
          store,
        }),
      slot: slotPayload({
        deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
        duration: 2,
        kind: "segment",
        maxBytes: 100_000,
        mediaSequenceNumber: 3810,
        objectKey: "media/v1080/3810.m4s",
        slotId: "slot_3810",
      }),
      upload: () => Promise.reject(new Error("upload failed")),
    });

    expect(step).toMatchObject({
      error: "upload failed",
      status: "upload_failed",
    });
  });
});

async function seedSession(
  store: ReturnType<typeof createMemoryCoordinatorStore>
): Promise<void> {
  const saved = await store.save({
    sessionId: session.sessionId,
    state: createCoordinatorPipeline({ pathways, session }),
  });

  if (saved.status !== "saved") {
    throw new Error("expected seeded session");
  }
}

async function seedInitUpload(
  store: ReturnType<typeof createMemoryCoordinatorStore>
): Promise<void> {
  await issueStoredCoordinatorSlotFromRequest({
    request: slotPayload({
      deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
      duration: 1,
      kind: "init",
      maxBytes: 2048,
      mediaSequenceNumber: 0,
      objectKey: "media/v1080/init.mp4",
      slotId: "slot_init",
    }),
    sessionId: session.sessionId,
    store,
  });

  const committed = await commitStoredCoordinatorUploadFromRequest({
    request: {
      commitId: "commit_init",
      committedAt: "2026-01-01T00:00:01.000Z",
      object: {
        contentType: "video/mp4",
        objectKey: "media/v1080/init.mp4",
        observedAt: "2026-01-01T00:00:01.000Z",
        providerId: "s3_primary",
        size: 1024,
      },
      slotId: "slot_init",
    },
    sessionId: session.sessionId,
    store,
  });

  if (committed.status !== "committed") {
    throw new Error("expected committed init upload");
  }
}

interface SlotPayloadOptions {
  deliveryUrl: string;
  duration: number;
  kind: "init" | "segment";
  maxBytes: number;
  mediaSequenceNumber: number;
  objectKey: string;
  slotId: string;
}

function slotPayload(options: SlotPayloadOptions) {
  return {
    contentType: "video/mp4",
    deliveryUrl: options.deliveryUrl,
    duration: options.duration,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: options.kind,
    maxBytes: options.maxBytes,
    mediaSequenceNumber: options.mediaSequenceNumber,
    objectKey: options.objectKey,
    publicationMode: "direct-public" as const,
    publisherInstanceId: "publisher_1",
    renditionId: "v1080",
    slotId: options.slotId,
  };
}
