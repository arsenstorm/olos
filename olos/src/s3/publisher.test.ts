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
import {
  createRuntimePublisherLease,
  heartbeatStoredCoordinatorPublisher,
  refreshRuntimePublisherLease,
  resolveRuntimePublisherLeaseStatus,
  resolveRuntimePublisherLoopDecision,
} from "../runtime";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import {
  commitStoredS3CoordinatorUpload,
  issueStoredS3CoordinatorUploadGrant,
} from "./coordinator";
import type { S3HeadObjectClient } from "./object-observation";
import {
  runNextStoredS3PublisherUploadStep,
  runPlannedStoredS3PublisherUploadStep,
  runStoredS3PublisherUploadStep,
  summarizeStoredS3PublisherUploadStep,
} from "./publisher";

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
  test("plans, grants, uploads, and commits one S3 object", async () => {
    const headObjectInputs: unknown[] = [];
    const uploadedUrls: string[] = [];
    const store = createMemoryCoordinatorStore();

    await store.save({
      sessionId: session.sessionId,
      state: createCoordinatorPipeline({ pathways, session }),
    });

    const step = await runPlannedStoredS3PublisherUploadStep({
      bucket: "media",
      client: createClient(),
      committedAt: "2026-01-01T00:00:02.000Z",
      headObjectClient: clientFor(
        "media/v1080/s3810/segment-slot_01JZ.m4s",
        98_304,
        headObjectInputs
      ),
      independent: true,
      now: "2026-01-01T00:00:00.000Z",
      plan: {
        baseUrl: "https://media.example.com",
        contentType: "video/mp4",
        duration: 2,
        extension: "m4s",
        kind: "segment",
        maxBytes: 100_000,
        mediaSequenceNumber: 3810,
        objectKeyNonce: "slot_01JZ",
        objectKeyPrefix: "media",
        publicationMode: "direct-public",
        publisherInstanceId: "publisher_1",
        renditionId: "v1080",
      },
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store,
      targetLatency: 3,
      upload: (grant) => {
        uploadedUrls.push(grant.url);

        return Promise.resolve();
      },
    });

    expect(step.status).toBe("committed");
    expect(summarizeStoredS3PublisherUploadStep(step)).toEqual({
      commitId: "commit_v1080_s3810",
      commitStatus: "committed",
      objectKey: "media/v1080/s3810/segment-slot_01JZ.m4s",
      ok: true,
      slotId: "slot_v1080_s3810",
      status: "committed",
    });
    expect(step.expiry).toEqual({
      expiresAt: "2026-01-01T00:00:05.000Z",
      ttlSeconds: 5,
    });
    expect(step.plan.commitId).toBe("commit_v1080_s3810");
    expect(step.plan.slot).toMatchObject({
      expiresAt: step.expiry.expiresAt,
      objectKey: "media/v1080/s3810/segment-slot_01JZ.m4s",
      slotId: "slot_v1080_s3810",
    });
    expect(uploadedUrls).toHaveLength(1);
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/v1080/s3810/segment-slot_01JZ.m4s",
      },
    ]);
  });

  test("derives the next S3 object from publisher cadence", async () => {
    const headObjectInputs: unknown[] = [];
    const uploadedUrls: string[] = [];
    const store = createMemoryCoordinatorStore();

    await store.save({
      sessionId: session.sessionId,
      state: createCoordinatorPipeline({ pathways, session }),
    });

    const step = await runNextStoredS3PublisherUploadStep({
      baseUrl: "https://media.example.com",
      bucket: "media",
      client: createClient(),
      committedAt: "2026-01-01T00:00:02.000Z",
      defaults: objectDefaults,
      headObjectClient: clientFor(
        "media/v1080/s3810/segment-slot_01K0.m4s",
        98_304,
        headObjectInputs
      ),
      independent: true,
      now: "2026-01-01T00:00:00.000Z",
      objectKeyNonce: "slot_01K0",
      objectKeyPrefix: "media",
      providerId: "s3_primary",
      publicationMode: "direct-public",
      publisherInstanceId: "publisher_1",
      renditionId: "v1080",
      sessionId: session.sessionId,
      startMediaSequenceNumber: 3810,
      store,
      targetLatency: 3,
      upload: (grant, plan) => {
        uploadedUrls.push(grant.url);
        expect(plan.commitId).toBe("commit_v1080_s3810");

        return Promise.resolve();
      },
    });

    expect(step.status).toBe("committed");
    expect(step.position).toEqual({
      kind: "segment",
      mediaSequenceNumber: 3810,
    });
    expect(step.expiry).toEqual({
      expiresAt: "2026-01-01T00:00:05.000Z",
      ttlSeconds: 5,
    });
    expect(step.plan.slot.objectKey).toBe(
      "media/v1080/s3810/segment-slot_01K0.m4s"
    );
    expect(uploadedUrls).toHaveLength(1);
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/v1080/s3810/segment-slot_01K0.m4s",
      },
    ]);
  });

  test("feeds cadence publisher steps into an app-owned retry loop", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    let attempt = 0;

    let step = await runNextStoredS3PublisherUploadStep({
      ...nextStepOptions({
        headObjectInputs,
        store,
      }),
      upload: () => Promise.reject(new Error("should not upload")),
    });
    let decision = resolveRuntimePublisherLoopDecision({
      attempt,
      maxAttempts: 2,
      step,
    });

    expect(step.status).toBe("issue_failed");
    expect(decision).toEqual({
      action: "retry",
      nextAttempt: 1,
    });

    if (decision.action !== "retry") {
      throw new Error("expected retry decision");
    }

    await store.save({
      sessionId: session.sessionId,
      state: createCoordinatorPipeline({ pathways, session }),
    });

    attempt = decision.nextAttempt;
    step = await runNextStoredS3PublisherUploadStep({
      ...nextStepOptions({
        headObjectInputs,
        store,
      }),
      upload: () => Promise.resolve(),
    });
    decision = resolveRuntimePublisherLoopDecision({
      attempt,
      maxAttempts: 2,
      step,
    });

    expect(step.status).toBe("committed");
    expect(decision).toEqual({ action: "continue" });
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/v1080/s3810/segment-slot_01L0.m4s",
      },
    ]);
  });

  test("composes the next S3 step with app-owned publisher liveness", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    let lease = createRuntimePublisherLease({
      now: "2026-01-01T00:00:00.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: session.sessionId,
      tenantId: session.tenantId,
      ttlMs: 3000,
    });

    await store.save({
      sessionId: session.sessionId,
      state: createCoordinatorPipeline({ pathways, session }),
    });

    const step = await runNextStoredS3PublisherUploadStep({
      ...nextStepOptions({
        headObjectInputs,
        store,
      }),
      upload: () => Promise.resolve(),
    });
    const decision = resolveRuntimePublisherLoopDecision({
      attempt: 0,
      maxAttempts: 2,
      step,
    });

    if (decision.action === "continue") {
      lease = refreshRuntimePublisherLease({
        lease,
        now: "2026-01-01T00:00:02.000Z",
        ttlMs: 3000,
      });
    }

    expect(decision).toEqual({ action: "continue" });
    expect(lease).toMatchObject({
      expiresAt: "2026-01-01T00:00:05.000Z",
      lastSeenAt: "2026-01-01T00:00:02.000Z",
    });
    expect(
      resolveRuntimePublisherLeaseStatus({
        lease,
        now: "2026-01-01T00:00:04.999Z",
      })
    ).toBe("active");
    expect(step.position).toEqual({
      kind: "segment",
      mediaSequenceNumber: 3810,
    });
  });

  test("keeps the full S3 publisher loop app-owned", async () => {
    const events: string[] = [];
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();

    await store.save({
      sessionId: session.sessionId,
      state: createCoordinatorPipeline({ pathways, session }),
    });

    const step = await runNextStoredS3PublisherUploadStep({
      ...nextStepOptions({
        headObjectInputs,
        store,
      }),
      heartbeat: async () => {
        events.push("pre-heartbeat");

        return await heartbeatStoredCoordinatorPublisher({
          now: "2026-01-01T00:00:00.000Z",
          publisherInstanceId: "publisher_1",
          sessionId: session.sessionId,
          store,
          ttlMs: 3000,
        });
      },
      upload: () => {
        events.push("upload");

        return Promise.resolve();
      },
    });
    const decision = resolveRuntimePublisherLoopDecision({
      attempt: 0,
      maxAttempts: 2,
      step,
    });

    if (decision.action === "continue") {
      events.push("post-heartbeat");
      await heartbeatStoredCoordinatorPublisher({
        now: "2026-01-01T00:00:02.000Z",
        publisherInstanceId: "publisher_1",
        sessionId: session.sessionId,
        store,
        ttlMs: 3000,
      });
    }

    const snapshot = await store.load(session.sessionId);
    const lease = snapshot?.state.publisherLeases.find(
      (entry) => entry.publisherInstanceId === "publisher_1"
    );

    expect(decision).toEqual({ action: "continue" });
    expect(events).toEqual(["pre-heartbeat", "upload", "post-heartbeat"]);
    expect(lease).toMatchObject({
      expiresAt: "2026-01-01T00:00:05.000Z",
      lastSeenAt: "2026-01-01T00:00:02.000Z",
    });
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/v1080/s3810/segment-slot_01L0.m4s",
      },
    ]);
  });

  test("summarizes rejected commit error codes", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();

    await store.save({
      sessionId: session.sessionId,
      state: createCoordinatorPipeline({ pathways, session }),
    });

    const step = await runPlannedStoredS3PublisherUploadStep({
      bucket: "media",
      client: createClient(),
      committedAt: "2026-01-01T00:00:02.000Z",
      commitPolicy: () => ({
        error: {
          error: {
            code: "olos.quota_exceeded",
            message: "publisher quota exceeded",
          },
        },
        status: "rejected",
      }),
      headObjectClient: clientFor(
        "media/v1080/s3810/segment-slot_01K1.m4s",
        98_304,
        headObjectInputs
      ),
      now: "2026-01-01T00:00:00.000Z",
      plan: {
        baseUrl: "https://media.example.com",
        contentType: "video/mp4",
        duration: 2,
        extension: "m4s",
        kind: "segment",
        maxBytes: 100_000,
        mediaSequenceNumber: 3810,
        objectKeyNonce: "slot_01K1",
        objectKeyPrefix: "media",
        publicationMode: "direct-public",
        publisherInstanceId: "publisher_1",
        renditionId: "v1080",
      },
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store,
      targetLatency: 3,
      upload: () => Promise.resolve(),
    });

    expect(summarizeStoredS3PublisherUploadStep(step)).toMatchObject({
      commitStatus: "rejected",
      errorCode: "olos.quota_exceeded",
      objectKey: "media/v1080/s3810/segment-slot_01K1.m4s",
      ok: false,
      slotId: "slot_v1080_s3810",
      status: "commit_failed",
    });
  });

  test("keeps planned context when upload fails", async () => {
    const store = createMemoryCoordinatorStore();

    await store.save({
      sessionId: session.sessionId,
      state: createCoordinatorPipeline({ pathways, session }),
    });

    const step = await runPlannedStoredS3PublisherUploadStep({
      bucket: "media",
      client: createClient(),
      committedAt: "2026-01-01T00:00:02.000Z",
      now: "2026-01-01T00:00:00.000Z",
      plan: {
        baseUrl: "https://media.example.com",
        contentType: "video/mp4",
        duration: 0.5,
        extension: "m4s",
        kind: "part",
        maxBytes: 25_000,
        mediaSequenceNumber: 3810,
        objectKeyNonce: "slot_01K2",
        objectKeyPrefix: "media",
        partNumber: 1,
        publicationMode: "direct-public",
        publisherInstanceId: "publisher_1",
        renditionId: "v1080",
      },
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store,
      targetLatency: 3,
      upload: () => Promise.reject(new Error("put failed")),
    });

    expect(step).toMatchObject({
      error: "put failed",
      expiry: {
        expiresAt: "2026-01-01T00:00:04.000Z",
        ttlSeconds: 4,
      },
      status: "upload_failed",
    });
    expect(summarizeStoredS3PublisherUploadStep(step)).toEqual({
      error: "put failed",
      objectKey: "media/v1080/s3810/p1-slot_01K2.m4s",
      ok: false,
      slotId: "slot_v1080_s3810_p1",
      status: "upload_failed",
    });
    expect(step.plan.slot).toMatchObject({
      objectKey: "media/v1080/s3810/p1-slot_01K2.m4s",
      partNumber: 1,
    });
  });

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

  test("refreshes heartbeat before issuing an S3 grant", async () => {
    const headObjectInputs: unknown[] = [];
    const events: string[] = [];
    const store = createMemoryCoordinatorStore();

    await store.save({
      sessionId: session.sessionId,
      state: createCoordinatorPipeline({ pathways, session }),
    });

    const step = await runNextStoredS3PublisherUploadStep({
      ...nextStepOptions({
        headObjectInputs,
        store,
      }),
      heartbeat: () => {
        events.push("heartbeat");

        return Promise.resolve({ status: "refreshed" });
      },
      upload: () => {
        events.push("upload");

        return Promise.resolve();
      },
    });

    expect(step).toMatchObject({
      heartbeat: { status: "refreshed" },
      status: "committed",
    });
    expect(summarizeStoredS3PublisherUploadStep(step)).toMatchObject({
      heartbeatStatus: "refreshed",
      ok: true,
      status: "committed",
    });
    expect(events).toEqual(["heartbeat", "upload"]);
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/v1080/s3810/segment-slot_01L0.m4s",
      },
    ]);
  });

  test("stops before S3 grant issuance when heartbeat fails", async () => {
    let grantIssued = false;

    const step = await runStoredS3PublisherUploadStep({
      commit: () => Promise.resolve({ status: "not_found" }),
      heartbeat: () => Promise.resolve({ status: "stale" }),
      issueGrant: () => {
        grantIssued = true;

        return Promise.resolve({ status: "not_found" });
      },
      upload: () => Promise.reject(new Error("should not upload")),
    });

    expect(step).toEqual({
      heartbeat: { status: "stale" },
      status: "heartbeat_failed",
    });
    expect(summarizeStoredS3PublisherUploadStep(step)).toEqual({
      heartbeatStatus: "stale",
      ok: false,
      status: "heartbeat_failed",
    });
    expect(grantIssued).toBe(false);
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

const objectDefaults = {
  init: {
    contentType: "video/mp4",
    duration: 1,
    extension: "mp4",
    maxBytes: 2048,
  },
  part: {
    contentType: "video/mp4",
    duration: 0.5,
    extension: "m4s",
    maxBytes: 25_000,
  },
  segment: {
    contentType: "video/mp4",
    duration: 2,
    extension: "m4s",
    maxBytes: 100_000,
  },
} as const;

function nextStepOptions(options: {
  headObjectInputs: unknown[];
  store: ReturnType<typeof createMemoryCoordinatorStore>;
}) {
  return {
    baseUrl: "https://media.example.com",
    bucket: "media",
    client: createClient(),
    committedAt: "2026-01-01T00:00:02.000Z",
    defaults: objectDefaults,
    headObjectClient: clientFor(
      "media/v1080/s3810/segment-slot_01L0.m4s",
      98_304,
      options.headObjectInputs
    ),
    independent: true,
    now: "2026-01-01T00:00:00.000Z",
    objectKeyNonce: "slot_01L0",
    objectKeyPrefix: "media",
    providerId: "s3_primary",
    publicationMode: "direct-public" as const,
    publisherInstanceId: "publisher_1",
    renditionId: "v1080",
    sessionId: session.sessionId,
    startMediaSequenceNumber: 3810,
    store: options.store,
    targetLatency: 3,
  };
}

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
