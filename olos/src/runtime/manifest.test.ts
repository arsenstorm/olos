import { describe, expect, test } from "bun:test";
import type { CoordinatorPipelineState } from "../protocol";
import {
  commitCoordinatorUpload,
  createCoordinatorPipeline,
  issueCoordinatorSlot,
} from "../protocol/coordinator";
import { createObservedUpload } from "../state/observed-upload";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import {
  serveBlockingCoordinatorManifest,
  serveCoordinatorManifest,
} from "./manifest";

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

describe("runtime manifest adapter", () => {
  test("serves a coordinator media playlist as a web response", async () => {
    const response = serveCoordinatorManifest({
      allowedMediaOrigins: ["https://media.example.com"],
      partTarget: session.partTarget,
      request: "/v1/live/session_1/v1080/media.m3u8",
      segmentTarget: session.segmentTarget,
      state: createReadyState(),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.apple.mpegurl"
    );
    expect(await response.text()).toContain(
      "https://media.example.com/s3810.m4s"
    );
  });

  test("returns not found before the coordinator has a cursor", async () => {
    const response = serveCoordinatorManifest({
      allowedMediaOrigins: ["https://media.example.com"],
      partTarget: session.partTarget,
      request: "/v1/live/session_1/v1080/media.m3u8",
      segmentTarget: session.segmentTarget,
      state: createCoordinatorPipeline({ pathways, session }),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("manifest not found");
  });

  test("serves blocking reloads through the current coordinator cursor", async () => {
    const response = await serveBlockingCoordinatorManifest({
      allowedMediaOrigins: ["https://media.example.com"],
      partTarget: session.partTarget,
      request: new Request(
        "https://edge.example.com/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3810"
      ),
      segmentTarget: session.segmentTarget,
      state: createReadyState(),
      timeoutMs: 100,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("#EXT-X-MEDIA-SEQUENCE:3810");
  });
});

function createReadyState(): CoordinatorPipelineState {
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

  return commitSlot(state, {
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
}

interface CommitSlotOptions {
  commitId: string;
  contentType: string;
  deliveryUrl: string;
  duration: number;
  independent?: boolean;
  maxBytes: number;
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
    contentType: options.contentType,
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
