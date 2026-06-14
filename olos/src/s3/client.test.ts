import { describe, expect, test } from "bun:test";
import {
  type HeadObjectCommand,
  type HeadObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import { createMemoryCoordinatorStore } from "../protocol";
import { createRuntimeSession, type RuntimeFetch } from "../runtime";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import {
  completeS3RuntimeUpload,
  issueS3RuntimeUploadGrant,
  S3RuntimeHttpError,
} from "./client";
import { createStoredS3CoordinatorRuntimeHandler } from "./http";
import type { S3HeadObjectClient } from "./object-observation";

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

describe("S3 runtime HTTP client", () => {
  test("issues S3 grants and completes uploads through the HTTP runtime", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        { "live/session/v1080/init.mp4": 1024 },
        headObjectInputs
      ),
      providerId: "s3_primary",
      store,
    });
    const clientFetch = runtimeFetchFor(handle);

    await createRuntimeSession({
      baseUrl: "https://edge.example.com",
      fetch: clientFetch,
      pathways,
      session,
    });

    const issued = await issueS3RuntimeUploadGrant({
      baseUrl: "https://edge.example.com",
      fetch: clientFetch,
      payload: {
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/live/session/v1080/init.mp4",
        duration: 1,
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "init",
        maxBytes: 2048,
        mediaSequenceNumber: 0,
        objectKey: "live/session/v1080/init.mp4",
        publicationMode: "direct-public",
        publisherInstanceId: "publisher_1",
        renditionId: "v1080",
        slotId: "slot_init",
      },
      sessionId: session.sessionId,
    });
    const completed = await completeS3RuntimeUpload({
      baseUrl: "https://edge.example.com",
      fetch: clientFetch,
      payload: {
        committedAt: "2026-01-01T00:00:02.000Z",
        etag: '"live/session/v1080/init.mp4"',
        objectKey: "live/session/v1080/init.mp4",
        size: 1024,
      },
      sessionId: session.sessionId,
      slotId: issued.slot.slotId,
    });

    expect(issued.response.status).toBe(201);
    expect(issued.grant.slotId).toBe("slot_init");
    expect(issued.slot.objectKey).toBe("live/session/v1080/init.mp4");
    expect(completed.response.status).toBe(201);
    expect(completed.commit).toMatchObject({
      commitId: "complete_slot_init",
      objectKey: "live/session/v1080/init.mp4",
      slotId: "slot_init",
    });
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "live/session/v1080/init.mp4",
      },
    ]);
  });

  test("throws typed errors for failed S3 runtime responses", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: "missing" } }), {
          headers: { "content-type": "application/json" },
          status: 404,
        })
      );

    const grantError = issueS3RuntimeUploadGrant({
      baseUrl: "https://edge.example.com",
      fetch: clientFetch,
      payload: {
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/init.mp4",
        duration: 1,
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "init",
        maxBytes: 2048,
        mediaSequenceNumber: 0,
        objectKey: "media/init-slot_1.mp4",
        publicationMode: "direct-public",
        publisherInstanceId: "publisher_1",
        renditionId: "v1080",
        slotId: "slot_init",
      },
      sessionId: session.sessionId,
    }).catch((error: unknown) => error);

    await expect(grantError).resolves.toBeInstanceOf(S3RuntimeHttpError);
    await expect(grantError).resolves.toMatchObject({
      body: { error: { message: "missing" } },
      message: "S3 upload grant issue failed with status 404",
      status: 404,
    });

    await expect(
      completeS3RuntimeUpload({
        baseUrl: "https://edge.example.com",
        fetch: clientFetch,
        sessionId: session.sessionId,
        slotId: "slot_init",
      })
    ).rejects.toThrow("S3 upload completion failed with status 404");
  });
});

function runtimeFetchFor(
  handle: (request: Request) => Promise<Response>
): RuntimeFetch {
  return (request, init) =>
    handle(
      request instanceof Request ? request : new Request(String(request), init)
    );
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

function objectClientFor(
  sizes: Record<string, number>,
  inputs: unknown[]
): S3HeadObjectClient {
  return {
    send(command: HeadObjectCommand): Promise<HeadObjectCommandOutput> {
      inputs.push(command.input);

      const objectKey = String(command.input.Key);
      const size = sizes[objectKey];

      if (size === undefined) {
        throw new Error(`unexpected object key: ${objectKey}`);
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
