import { describe, expect, test } from "bun:test";
import {
  type DeleteObjectCommand,
  type DeleteObjectCommandOutput,
  type HeadObjectCommand,
  type HeadObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import { createMemoryCoordinatorStore } from "../protocol";
import { createRuntimeSession, type RuntimeFetch } from "../runtime";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import {
  applyS3RuntimeRetention,
  commitS3RuntimeUpload,
  completeS3RuntimeUpload,
  issueS3RuntimeUploadGrant,
  planS3RuntimeReconciliation,
  reconcileS3RuntimeUploads,
  S3RuntimeHttpError,
} from "./client";
import { createStoredS3CoordinatorRuntimeHandler } from "./http";
import type { S3HeadObjectClient } from "./object-observation";
import type { S3DeleteObjectClient } from "./retention";

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
        {
          "live/session/v1080/3810.m4s": 98_304,
          "live/session/v1080/init.mp4": 1024,
        },
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
    const segment = await issueS3RuntimeUploadGrant({
      baseUrl: "https://edge.example.com",
      fetch: clientFetch,
      payload: {
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
        duration: 2,
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "segment",
        maxBytes: 100_000,
        mediaSequenceNumber: 3810,
        objectKey: "live/session/v1080/3810.m4s",
        publicationMode: "direct-public",
        publisherInstanceId: "publisher_1",
        renditionId: "v1080",
        slotId: "slot_3810",
      },
      sessionId: session.sessionId,
    });
    const committed = await commitS3RuntimeUpload({
      baseUrl: "https://edge.example.com",
      fetch: clientFetch,
      payload: {
        commitId: "commit_init",
        committedAt: "2026-01-01T00:00:02.000Z",
        objectKey: "live/session/v1080/init.mp4",
        slotId: issued.slot.slotId,
      },
      sessionId: session.sessionId,
    });
    const completed = await completeS3RuntimeUpload({
      baseUrl: "https://edge.example.com",
      fetch: clientFetch,
      payload: {
        committedAt: "2026-01-01T00:00:03.000Z",
        etag: '"live/session/v1080/3810.m4s"',
        independent: true,
        objectKey: "live/session/v1080/3810.m4s",
        size: 98_304,
      },
      sessionId: session.sessionId,
      slotId: segment.slot.slotId,
    });

    expect(issued.response.status).toBe(201);
    expect(issued.grant.slotId).toBe("slot_init");
    expect(issued.slot.objectKey).toBe("live/session/v1080/init.mp4");
    expect(committed.response.status).toBe(201);
    expect(committed.commit).toMatchObject({
      commitId: "commit_init",
      objectKey: "live/session/v1080/init.mp4",
      slotId: "slot_init",
    });
    expect(completed.response.status).toBe(201);
    expect(completed.commit).toMatchObject({
      commitId: "complete_slot_3810",
      objectKey: "live/session/v1080/3810.m4s",
      slotId: "slot_3810",
    });
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "live/session/v1080/init.mp4",
      },
      {
        Bucket: "media",
        Key: "live/session/v1080/3810.m4s",
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
      commitS3RuntimeUpload({
        baseUrl: "https://edge.example.com",
        fetch: clientFetch,
        payload: {
          commitId: "commit_init",
          committedAt: "2026-01-01T00:00:02.000Z",
          slotId: "slot_init",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("S3 upload commit failed with status 404");

    await expect(
      planS3RuntimeReconciliation({
        baseUrl: "https://edge.example.com",
        fetch: clientFetch,
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("S3 reconciliation plan failed with status 404");

    await expect(
      reconcileS3RuntimeUploads({
        baseUrl: "https://edge.example.com",
        fetch: clientFetch,
        payload: {
          committedAt: "2026-01-01T00:00:02.000Z",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("S3 upload reconciliation failed with status 404");

    await expect(
      applyS3RuntimeRetention({
        baseUrl: "https://edge.example.com",
        fetch: clientFetch,
        payload: {
          now: "2026-01-01T00:00:06.000Z",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("S3 retention failed with status 404");

    await expect(
      completeS3RuntimeUpload({
        baseUrl: "https://edge.example.com",
        fetch: clientFetch,
        sessionId: session.sessionId,
        slotId: "slot_init",
      })
    ).rejects.toThrow("S3 upload completion failed with status 404");
  });

  test("rejects unsafe S3 runtime route identifiers before fetch", async () => {
    let requests = 0;
    const clientFetch: RuntimeFetch = () => {
      requests += 1;
      return Promise.resolve(new Response("{}", { status: 200 }));
    };
    const options = {
      baseUrl: "https://edge.example.com",
      fetch: clientFetch,
      sessionId: "../session",
    };

    await expect(planS3RuntimeReconciliation(options)).rejects.toThrow(
      "sessionId must be a non-empty URL-safe identifier"
    );
    await expect(
      completeS3RuntimeUpload({
        ...options,
        sessionId: session.sessionId,
        slotId: "../slot",
      })
    ).rejects.toThrow("slotId must be a non-empty URL-safe identifier");
    expect(requests).toBe(0);
  });

  test("plans and reconciles missed S3 uploads through the HTTP runtime", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        {
          "live/session/v1080/3810.m4s": 98_304,
          "live/session/v1080/init.mp4": 1024,
        },
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

    await issueS3RuntimeUploadGrant({
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
    await issueS3RuntimeUploadGrant({
      baseUrl: "https://edge.example.com",
      fetch: clientFetch,
      payload: {
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
        duration: 2,
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "segment",
        maxBytes: 100_000,
        mediaSequenceNumber: 3810,
        objectKey: "live/session/v1080/3810.m4s",
        publicationMode: "direct-public",
        publisherInstanceId: "publisher_1",
        renditionId: "v1080",
        slotId: "slot_3810",
      },
      sessionId: session.sessionId,
    });

    const plan = await planS3RuntimeReconciliation({
      baseUrl: "https://edge.example.com",
      fetch: clientFetch,
      payload: {
        slotIds: ["slot_3810"],
      },
      sessionId: session.sessionId,
    });
    const reconciled = await reconcileS3RuntimeUploads({
      baseUrl: "https://edge.example.com",
      fetch: clientFetch,
      payload: {
        committedAt: "2026-01-01T00:00:02.000Z",
      },
      sessionId: session.sessionId,
    });

    expect(plan.response.status).toBe(200);
    expect(plan).toMatchObject({
      slotIds: ["slot_3810"],
      status: "planned",
    });
    expect(reconciled.response.status).toBe(202);
    expect(reconciled.summary).toMatchObject({
      committed: 2,
      failed: 0,
      ok: true,
      planned: 2,
      status: "reconciled",
    });
    expect(reconciled.results).toMatchObject([
      {
        slotId: "slot_init",
        status: "committed",
      },
      {
        slotId: "slot_3810",
        status: "committed",
      },
    ]);
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "live/session/v1080/init.mp4",
      },
      {
        Bucket: "media",
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("applies S3 retention through the HTTP runtime", async () => {
    const deleteInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        {
          "live/session/v1080/3810.m4s": 98_304,
          "live/session/v1080/3811.m4s": 98_304,
          "live/session/v1080/init.mp4": 1024,
        },
        []
      ),
      retentionClient: deleteClientFor(deleteInputs),
      store,
    });
    const clientFetch = runtimeFetchFor(handle);

    await createRuntimeSession({
      baseUrl: "https://edge.example.com",
      fetch: clientFetch,
      pathways,
      session,
    });

    for (const object of [
      {
        commitId: "commit_init",
        duration: 1,
        kind: "init" as const,
        maxBytes: 2048,
        mediaSequenceNumber: 0,
        objectKey: "live/session/v1080/init.mp4",
        slotId: "slot_init",
      },
      {
        commitId: "commit_3810",
        duration: 2,
        kind: "segment" as const,
        maxBytes: 100_000,
        mediaSequenceNumber: 3810,
        objectKey: "live/session/v1080/3810.m4s",
        slotId: "slot_3810",
      },
      {
        commitId: "commit_3811",
        duration: 2,
        kind: "segment" as const,
        maxBytes: 100_000,
        mediaSequenceNumber: 3811,
        objectKey: "live/session/v1080/3811.m4s",
        slotId: "slot_3811",
      },
    ]) {
      await issueS3RuntimeUploadGrant({
        baseUrl: "https://edge.example.com",
        fetch: clientFetch,
        payload: {
          contentType: "video/mp4",
          deliveryUrl: `https://media.example.com/${object.objectKey}`,
          duration: object.duration,
          expiresAt: "2026-01-01T00:00:05.000Z",
          kind: object.kind,
          maxBytes: object.maxBytes,
          mediaSequenceNumber: object.mediaSequenceNumber,
          objectKey: object.objectKey,
          publicationMode: "direct-public",
          publisherInstanceId: "publisher_1",
          renditionId: "v1080",
          slotId: object.slotId,
        },
        sessionId: session.sessionId,
      });
      await commitS3RuntimeUpload({
        baseUrl: "https://edge.example.com",
        fetch: clientFetch,
        payload: {
          commitId: object.commitId,
          committedAt: "2026-01-01T00:00:02.000Z",
          independent: object.kind === "segment",
          objectKey: object.objectKey,
          providerId: "s3_primary",
          slotId: object.slotId,
          ...(object.kind === "segment" ? { maxSegments: 1 } : {}),
        },
        sessionId: session.sessionId,
      });
    }

    const retained = await applyS3RuntimeRetention({
      baseUrl: "https://edge.example.com",
      fetch: clientFetch,
      payload: {
        now: "2026-01-01T00:00:06.000Z",
      },
      sessionId: session.sessionId,
    });

    expect(retained.response.status).toBe(202);
    expect(retained.plan.retiredObjects).toEqual([
      {
        commitId: "commit_3810",
        objectKey: "live/session/v1080/3810.m4s",
        slotId: "slot_3810",
      },
    ]);
    expect(retained.summary).toEqual({
      deleted: 1,
      failed: 0,
      failedObjectKeys: [],
      failedSlotIds: [],
      ok: true,
      planned: 1,
    });
    expect(deleteInputs).toEqual([
      {
        Bucket: "media",
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
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

function deleteClientFor(inputs: unknown[]): S3DeleteObjectClient {
  return {
    send(command: DeleteObjectCommand): Promise<DeleteObjectCommandOutput> {
      inputs.push(command.input);

      return Promise.resolve({ $metadata: {} });
    },
  };
}
