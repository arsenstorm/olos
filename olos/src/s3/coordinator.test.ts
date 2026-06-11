import { describe, expect, test } from "bun:test";
import {
  type HeadObjectCommand,
  type HeadObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  createCoordinatorPipeline,
  createMemoryCoordinatorStore,
  issueCoordinatorSlot,
} from "../protocol/coordinator";
import { normalizeUploadEvent } from "../state/observed-upload";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import {
  commitS3CoordinatorUpload,
  commitStoredS3CoordinatorUpload,
  completeStoredS3CoordinatorUpload,
  completeStoredS3CoordinatorUploadByObjectKey,
  issueS3CoordinatorUploadGrant,
  issueStoredS3CoordinatorUploadGrant,
  routeStoredS3CoordinatorUploadEvent,
} from "./coordinator";
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

describe("s3 coordinator uploads", () => {
  test("issues and persists an S3 coordinator upload grant", async () => {
    const store = createMemoryCoordinatorStore();
    const state = createCoordinatorPipeline({ pathways, session });
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const issue = await issueStoredS3CoordinatorUploadGrant({
      bucket: "media",
      client: createClient(),
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      expiresInSeconds: 3,
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      now: "2026-01-01T00:00:00.000Z",
      objectKey: "live/session/v1080/3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store,
    });

    expect(issue.status).toBe("saved");
    if (issue.status !== "saved") {
      throw new Error("expected stored grant issue");
    }

    const stored = await store.load(session.sessionId);

    expect(issue.etag).toBe("2");
    expect(issue.grant.slotId).toBe("slot_3810");
    expect(issue.slot.objectKey).toBe("live/session/v1080/3810.m4s");
    expect(stored?.etag).toBe("2");
    expect(stored?.state.slots).toEqual([issue.slot]);
  });

  test("does not sign stored S3 grants for missing coordinator sessions", async () => {
    const result = await issueStoredS3CoordinatorUploadGrant({
      bucket: "media",
      client: createClient(),
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      expiresInSeconds: 3,
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      now: "2026-01-01T00:00:00.000Z",
      objectKey: "live/session/v1080/3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store: createMemoryCoordinatorStore(),
    });

    expect(result).toEqual({ status: "not_found" });
  });

  test("issues a coordinator slot with an S3 upload grant", async () => {
    const state = createCoordinatorPipeline({ pathways, session });
    const issue = await issueS3CoordinatorUploadGrant({
      bucket: "media",
      client: createClient(),
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      expiresInSeconds: 3,
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      now: "2026-01-01T00:00:00.000Z",
      objectKey: "live/session/v1080/3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_3810",
      state,
    });
    const url = new URL(issue.grant.url);

    expect(issue.slot).toMatchObject({
      objectKey: "live/session/v1080/3810.m4s",
      slotId: "slot_3810",
      state: "issued",
    });
    expect(issue.state.slots).toEqual([issue.slot]);
    expect(issue.grant).toMatchObject({
      expiresAt: "2026-01-01T00:00:03.000Z",
      method: "PUT",
      requiredHeaders: {
        "Content-Type": "video/mp4",
        "If-None-Match": "*",
        "x-olos-slot-id": "slot_3810",
      },
      slotId: "slot_3810",
    });
    expect(url.pathname).toBe("/media/live/session/v1080/3810.m4s");
  });

  test("observes the issued S3 object before committing", async () => {
    const headObjectInputs: unknown[] = [];
    let state = createCoordinatorPipeline({ pathways, session });
    state = issueCoordinatorSlot({
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
    }).state;

    const initCommit = await commitS3CoordinatorUpload({
      bucket: "media",
      client: clientFor("media/init.mp4", 1024, headObjectInputs),
      commitId: "commit_init",
      committedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      slotId: "slot_init",
      state,
    });

    if (initCommit.status !== "committed") {
      throw new Error("expected init commit");
    }

    state = initCommit.state;
    state = issueCoordinatorSlot({
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
    }).state;

    const segmentCommit = await commitS3CoordinatorUpload({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: true,
      providerId: "s3_primary",
      slotId: "slot_3810",
      state,
    });

    expect(segmentCommit.status).toBe("committed");
    if (segmentCommit.status !== "committed") {
      throw new Error("expected segment commit");
    }

    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/init.mp4",
      },
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
    expect(segmentCommit.commit.objectKey).toBe("media/s3810.m4s");
    expect(segmentCommit.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
  });

  test("observes and persists S3 coordinator upload commits", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    let state = createCoordinatorPipeline({ pathways, session });
    state = issueCoordinatorSlot({
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
    }).state;
    state = issueCoordinatorSlot({
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
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const initCommit = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: clientFor("media/init.mp4", 1024, headObjectInputs),
      commitId: "commit_init",
      committedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_init",
      store,
    });
    const segmentCommit = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
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
    if (segmentCommit.status !== "committed") {
      throw new Error("expected persisted segment commit");
    }

    const stored = await store.load(session.sessionId);

    expect(segmentCommit.etag).toBe("3");
    expect(stored?.etag).toBe("3");
    expect(stored?.state.commits).toEqual([segmentCommit.commit]);
    expect(stored?.state.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/init.mp4",
      },
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
  });

  test("derives manifests from stored S3 coordinator commits", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    let state = createCoordinatorPipeline({ pathways, session });
    state = issueCoordinatorSlot({
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
    }).state;
    state = issueCoordinatorSlot({
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
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: clientFor("media/init.mp4", 1024, headObjectInputs),
      commitId: "commit_init",
      committedAt: "2026-01-01T00:00:01.000Z",
      manifest: {
        allowedMediaOrigins: ["https://media.example.com"],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_init",
      store,
    });

    const segmentCommit = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: true,
      manifest: {
        allowedMediaOrigins: ["https://media.example.com"],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store,
    });

    expect(segmentCommit.status).toBe("committed");
    if (segmentCommit.status !== "committed") {
      throw new Error("expected persisted segment commit");
    }

    expect(
      segmentCommit.manifest?.artifacts.map((artifact) => artifact.path)
    ).toEqual([
      "/v1/live/session_1/master.m3u8",
      "/v1/live/session_1/v1080/media.m3u8",
    ]);
    expect(segmentCommit.manifest?.artifacts[1]?.body).toContain(
      "https://media.example.com/s3810.m4s"
    );
  });

  test("completes stored S3 uploads from a matching object key hint", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    let state = createCoordinatorPipeline({ pathways, session });
    state = issueCoordinatorSlot({
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
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const result = await completeStoredS3CoordinatorUpload({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      objectKey: "media/s3810.m4s",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store,
    });

    expect(result.status).toBe("committed");
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
  });

  test("rejects stored S3 completion hints with mismatched object keys", async () => {
    const store = createMemoryCoordinatorStore();
    const state = issueCoordinatorSlot({
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
      state: createCoordinatorPipeline({ pathways, session }),
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const result = await completeStoredS3CoordinatorUpload({
      bucket: "media",
      client: {
        send(): Promise<HeadObjectCommandOutput> {
          throw new Error("unexpected s3 call");
        },
      },
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      objectKey: "media/other.m4s",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store,
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected rejected completion");
    }

    expect(result.error.error.code).toBe("olos.key_mismatch");
  });

  test("completes stored S3 uploads by object key", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const state = issueCoordinatorSlot({
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
      state: createCoordinatorPipeline({ pathways, session }),
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const result = await completeStoredS3CoordinatorUploadByObjectKey({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      objectKey: "media/s3810.m4s",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("committed");
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
  });

  test("rejects unknown object-key completions before querying S3", async () => {
    const store = createMemoryCoordinatorStore();
    await store.save({
      sessionId: session.sessionId,
      state: createCoordinatorPipeline({ pathways, session }),
    });

    const result = await completeStoredS3CoordinatorUploadByObjectKey({
      bucket: "media",
      client: {
        send(): Promise<HeadObjectCommandOutput> {
          throw new Error("unexpected s3 call");
        },
      },
      commitId: "commit_unknown",
      committedAt: "2026-01-01T00:00:02.000Z",
      objectKey: "media/unknown.m4s",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected rejected completion");
    }

    expect(result.error.error.code).toBe("olos.unknown_slot");
  });

  test("routes object-created events to object-key S3 completion", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const state = issueCoordinatorSlot({
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
      state: createCoordinatorPipeline({ pathways, session }),
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const result = await routeStoredS3CoordinatorUploadEvent({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
      event: normalizeUploadEvent({
        event: {
          contentType: "video/mp4",
          eventId: "evt_3810",
          eventTime: "2026-01-01T00:00:02.000Z",
          eventType: "object.created",
          objectKey: "media/s3810.m4s",
          providerId: "s3_primary",
          size: 98_304,
        },
      }),
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("committed");
    if (result.status !== "committed") {
      throw new Error("expected routed object-created commit");
    }

    expect(result.commit.commitId).toBe("evt_3810");
    expect(result.commit.committedAt).toBe("2026-01-01T00:00:02.000Z");
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
  });

  test("routes upload-completed hints to keyed S3 completion", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const state = issueCoordinatorSlot({
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
      state: createCoordinatorPipeline({ pathways, session }),
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const result = await routeStoredS3CoordinatorUploadEvent({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
      event: normalizeUploadEvent({
        event: {
          eventId: "hint_3810",
          eventTime: "2026-01-01T00:00:02.000Z",
          eventType: "upload.completed",
          objectKey: "media/s3810.m4s",
          slotId: "slot_3810",
        },
      }),
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("committed");
    if (result.status !== "committed") {
      throw new Error("expected routed upload-completed commit");
    }

    expect(result.commit.commitId).toBe("hint_3810");
    expect(result.commit.committedAt).toBe("2026-01-01T00:00:02.000Z");
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
  });

  test("returns invalid upload events without querying S3", async () => {
    const result = await routeStoredS3CoordinatorUploadEvent({
      bucket: "media",
      client: {
        send(): Promise<HeadObjectCommandOutput> {
          throw new Error("unexpected s3 call");
        },
      },
      event: normalizeUploadEvent({ event: null }),
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store: createMemoryCoordinatorStore(),
    });

    expect(result.status).toBe("invalid_event");
    if (result.status !== "invalid_event") {
      throw new Error("expected invalid event");
    }

    expect(result.error.error.code).toBe("olos.invalid_state");
  });

  test("does not query S3 for missing stored coordinator sessions", async () => {
    const result = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: {
        send(): Promise<HeadObjectCommandOutput> {
          throw new Error("unexpected s3 call");
        },
      },
      commitId: "commit_missing",
      committedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store: createMemoryCoordinatorStore(),
    });

    expect(result).toEqual({ status: "not_found" });
  });

  test("does not query S3 for unknown slots", async () => {
    const state = createCoordinatorPipeline({ pathways, session });
    const result = await commitS3CoordinatorUpload({
      bucket: "media",
      client: {
        send(): Promise<HeadObjectCommandOutput> {
          throw new Error("unexpected s3 call");
        },
      },
      commitId: "commit_unknown",
      committedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
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
