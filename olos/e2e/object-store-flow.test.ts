import {
  type HeadObjectCommand,
  type HeadObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import { renderMediaPlaylist } from "olos/hls";
import {
  createCoordinatorPipeline,
  createMemoryCoordinatorStore,
} from "olos/protocol";
import {
  commitStoredS3CoordinatorUpload,
  issueStoredS3CoordinatorUploadGrant,
  type S3HeadObjectClient,
} from "olos/s3";
import type { Pathway, Session } from "olos/types";
import { assertCursor } from "olos/validation";
import { describe, expect, test } from "vitest";

const session = {
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
} satisfies Session;

const pathways = [
  {
    baseUrl: "https://media.example.com",
    pathwayId: "primary",
    priority: 0,
    providerId: "s3_primary",
    state: "active",
  },
] satisfies Pathway[];

describe("object-store flow", () => {
  test("publishes S3 uploads from stored coordinator state to HLS", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    await store.save({
      sessionId: session.sessionId,
      state: createCoordinatorPipeline({ pathways, session }),
    });

    const init = await issueStoredS3CoordinatorUploadGrant({
      bucket: "media",
      client: createS3Client(),
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
      duration: 1,
      expiresAt: "2026-01-01T00:00:05.000Z",
      expiresInSeconds: 3,
      kind: "init",
      maxBytes: 2048,
      mediaSequenceNumber: 0,
      now: "2026-01-01T00:00:00.000Z",
      objectKey: "media/v1080/init.mp4",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      sessionId: session.sessionId,
      slotId: "slot_init",
      store,
    });
    const segment = await issueStoredS3CoordinatorUploadGrant({
      bucket: "media",
      client: createS3Client(),
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      expiresInSeconds: 3,
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      now: "2026-01-01T00:00:00.000Z",
      objectKey: "media/v1080/3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store,
    });

    expect(init.status).toBe("saved");
    expect(segment.status).toBe("saved");

    const initCommit = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: headObjectClient(headObjectInputs, 1024),
      commitId: "commit_init",
      committedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_init",
      store,
    });
    const segmentCommit = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: headObjectClient(headObjectInputs, 98_304),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: true,
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store,
    });

    expect(initCommit.status).toBe("committed");
    expect(segmentCommit.status).toBe("committed");

    const stored = await store.load(session.sessionId);
    const cursor = stored?.state.cursor;

    if (cursor === undefined) {
      throw new Error("expected stored cursor");
    }

    assertCursor(cursor);

    const playlist = renderMediaPlaylist(cursor.committedWindow, {
      allowedMediaOrigins: ["https://media.example.com"],
      partTarget: session.partTarget,
      renditionId: "v1080",
      segmentTarget: session.segmentTarget,
      targetLatency: 3,
    });

    expect(cursor.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(playlist).toContain(
      '#EXT-X-MAP:URI="https://media.example.com/media/v1080/init.mp4"'
    );
    expect(playlist).toContain(
      "https://media.example.com/media/v1080/3810.m4s"
    );
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
});

function createS3Client(): S3Client {
  return new S3Client({
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    endpoint: "https://s3.example.com",
    forcePathStyle: true,
    region: "us-east-1",
  });
}

function headObjectClient(inputs: unknown[], size: number): S3HeadObjectClient {
  return {
    send(command: HeadObjectCommand): Promise<HeadObjectCommandOutput> {
      inputs.push(command.input);

      return Promise.resolve({
        $metadata: {},
        ContentLength: size,
        ContentType: "video/mp4",
        ETag: `"${command.input.Key}"`,
        LastModified: new Date("2026-01-01T00:00:01.000Z"),
      });
    },
  };
}
