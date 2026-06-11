import { describe, expect, test } from "bun:test";
import {
  type HeadObjectCommand,
  type HeadObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  createCoordinatorPipeline,
  createMemoryCoordinatorStore,
} from "../protocol";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import {
  commitStoredS3CoordinatorUpload,
  issueStoredS3CoordinatorUploadGrant,
} from "./coordinator";
import type { S3HeadObjectClient } from "./object-observation";
import { runStoredS3PublisherUploadStep } from "./publisher";

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

describe("stored S3 publisher upload step", () => {
  test("issues a grant, uploads with the app callback, and commits", async () => {
    const headObjectInputs: unknown[] = [];
    const uploadedUrls: string[] = [];
    const store = createMemoryCoordinatorStore();

    await store.save({
      sessionId: session.sessionId,
      state: createCoordinatorPipeline({ pathways, session }),
    });

    const step = await runStoredS3PublisherUploadStep({
      commit: (slot) =>
        commitStoredS3CoordinatorUpload({
          bucket: "media",
          client: clientFor(slot.objectKey, 98_304, headObjectInputs),
          commitId: "commit_3810",
          committedAt: "2026-01-01T00:00:02.000Z",
          independent: true,
          providerId: "s3_primary",
          sessionId: session.sessionId,
          slotId: slot.slotId,
          store,
        }),
      issueGrant: () =>
        issueStoredS3CoordinatorUploadGrant({
          bucket: "media",
          client: createClient(),
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
          publisherInstanceId: "publisher_1",
          renditionId: "v1080",
          sessionId: session.sessionId,
          slotId: "slot_3810",
          store,
        }),
      upload: (grant) => {
        uploadedUrls.push(grant.url);

        return Promise.resolve();
      },
    });

    expect(step.status).toBe("committed");
    expect(uploadedUrls).toHaveLength(1);
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/v1080/3810.m4s",
      },
    ]);
  });

  test("stops before commit when app upload fails", async () => {
    const store = createMemoryCoordinatorStore();

    await store.save({
      sessionId: session.sessionId,
      state: createCoordinatorPipeline({ pathways, session }),
    });

    const step = await runStoredS3PublisherUploadStep({
      commit: () => Promise.resolve({ status: "not_found" }),
      issueGrant: () =>
        issueStoredS3CoordinatorUploadGrant({
          bucket: "media",
          client: createClient(),
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
          publisherInstanceId: "publisher_1",
          renditionId: "v1080",
          sessionId: session.sessionId,
          slotId: "slot_3810",
          store,
        }),
      upload: () => Promise.reject(new Error("put failed")),
    });

    expect(step).toMatchObject({
      error: "put failed",
      status: "upload_failed",
    });
  });
});

function clientFor(
  objectKey: string,
  size: number,
  inputs: unknown[]
): S3HeadObjectClient {
  return {
    send(command: HeadObjectCommand): Promise<HeadObjectCommandOutput> {
      inputs.push(command.input);

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

function createClient(): S3Client {
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
