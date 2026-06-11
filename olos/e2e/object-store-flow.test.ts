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
  completeStoredS3CoordinatorUploadByObjectKey,
  issueStoredS3CoordinatorUploadGrant,
  routeStoredS3CoordinatorUploadEvent,
  type S3HeadObjectClient,
} from "olos/s3";
import { normalizeUploadEvent } from "olos/state";
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
    const store = await createStoredPipeline();
    const issued = await issueInitAndSegment(store);

    expect(issued.init.status).toBe("saved");
    expect(issued.segment.status).toBe("saved");

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

  test("publishes S3 object-created events through stored coordinator state", async () => {
    const headObjectInputs: unknown[] = [];
    const store = await createStoredPipeline();
    const issued = await issueInitAndSegment(store);

    expect(issued.init.status).toBe("saved");
    expect(issued.segment.status).toBe("saved");

    await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: headObjectClient(headObjectInputs, 1024),
      commitId: "commit_init",
      committedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_init",
      store,
    });

    const event = normalizeUploadEvent({
      event: {
        contentType: "video/mp4",
        etag: '"media/v1080/3810.m4s"',
        eventId: "evt_3810",
        eventTime: "2026-01-01T00:00:02.000Z",
        eventType: "object.created",
        objectKey: "media/v1080/3810.m4s",
        providerId: "s3_primary",
        size: 98_304,
      },
    });

    expect(event.status).toBe("object_created");
    if (event.status !== "object_created") {
      throw new Error("expected object-created event");
    }

    const segmentCommit = await completeStoredS3CoordinatorUploadByObjectKey({
      bucket: "media",
      client: headObjectClient(headObjectInputs, event.event.object.size),
      commitId: event.event.eventId,
      committedAt: event.event.object.observedAt,
      independent: true,
      objectKey: event.event.object.objectKey,
      providerId: event.event.object.providerId,
      sessionId: session.sessionId,
      store,
    });

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

  test("publishes low-latency S3 parts before the full segment is committed", async () => {
    const headObjectInputs: unknown[] = [];
    const store = await createStoredPipeline();
    const issued = await issueLowLatencySlots(store);

    expect(issued.init.status).toBe("saved");
    expect(issued.segment.status).toBe("saved");
    expect(issued.part0.status).toBe("saved");
    expect(issued.part1.status).toBe("saved");

    await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: headObjectClient(headObjectInputs, 1024),
      commitId: "commit_init",
      committedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_init",
      store,
    });
    await routeUploadEvent({
      headObjectInputs,
      independent: true,
      objectKey: "media/v1080/3810.m4s",
      size: 98_304,
      store,
    });
    await routeUploadEvent({
      eventId: "evt_3811_0",
      headObjectInputs,
      independent: true,
      objectKey: "media/v1080/3811.p0.m4s",
      size: 24_000,
      store,
    });
    await routeUploadEvent({
      eventId: "evt_3811_1",
      eventTime: "2026-01-01T00:00:02.500Z",
      headObjectInputs,
      objectKey: "media/v1080/3811.p1.m4s",
      size: 24_000,
      store,
    });

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
      lastMediaSequenceNumber: 3811,
      lastPartNumber: 1,
    });
    expect(playlist).toContain("#EXT-X-PART-INF:PART-TARGET=0.500");
    expect(playlist).toContain(
      '#EXT-X-PART:DURATION=0.500,INDEPENDENT=YES,URI="https://media.example.com/media/v1080/3811.p0.m4s"'
    );
    expect(playlist).toContain(
      '#EXT-X-PART:DURATION=0.500,URI="https://media.example.com/media/v1080/3811.p1.m4s"'
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
      {
        Bucket: "media",
        Key: "media/v1080/3811.p0.m4s",
      },
      {
        Bucket: "media",
        Key: "media/v1080/3811.p1.m4s",
      },
    ]);
  });
});

async function createStoredPipeline() {
  const store = createMemoryCoordinatorStore();
  await store.save({
    sessionId: session.sessionId,
    state: createCoordinatorPipeline({ pathways, session }),
  });

  return store;
}

async function issueInitAndSegment(
  store: ReturnType<typeof createMemoryCoordinatorStore>
) {
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

  return { init, segment };
}

async function issueLowLatencySlots(
  store: ReturnType<typeof createMemoryCoordinatorStore>
) {
  const issued = await issueInitAndSegment(store);
  const part0 = await issueStoredS3CoordinatorUploadGrant({
    bucket: "media",
    client: createS3Client(),
    contentType: "video/mp4",
    deliveryUrl: "https://media.example.com/media/v1080/3811.p0.m4s",
    duration: 0.5,
    expiresAt: "2026-01-01T00:00:05.000Z",
    expiresInSeconds: 3,
    kind: "segment",
    maxBytes: 25_000,
    mediaSequenceNumber: 3811,
    now: "2026-01-01T00:00:00.000Z",
    objectKey: "media/v1080/3811.p0.m4s",
    partNumber: 0,
    publicationMode: "direct-public",
    publisherInstanceId: "pub_1",
    renditionId: "v1080",
    sessionId: session.sessionId,
    slotId: "slot_3811_0",
    store,
  });
  const part1 = await issueStoredS3CoordinatorUploadGrant({
    bucket: "media",
    client: createS3Client(),
    contentType: "video/mp4",
    deliveryUrl: "https://media.example.com/media/v1080/3811.p1.m4s",
    duration: 0.5,
    expiresAt: "2026-01-01T00:00:05.000Z",
    expiresInSeconds: 3,
    kind: "segment",
    maxBytes: 25_000,
    mediaSequenceNumber: 3811,
    now: "2026-01-01T00:00:00.000Z",
    objectKey: "media/v1080/3811.p1.m4s",
    partNumber: 1,
    publicationMode: "direct-public",
    publisherInstanceId: "pub_1",
    renditionId: "v1080",
    sessionId: session.sessionId,
    slotId: "slot_3811_1",
    store,
  });

  return { ...issued, part0, part1 };
}

async function routeUploadEvent(options: {
  eventId?: string;
  eventTime?: string;
  headObjectInputs: unknown[];
  independent?: boolean;
  objectKey: string;
  size: number;
  store: ReturnType<typeof createMemoryCoordinatorStore>;
}) {
  const event = normalizeUploadEvent({
    event: {
      contentType: "video/mp4",
      etag: `"${options.objectKey}"`,
      eventId: options.eventId ?? "evt_3810",
      eventTime: options.eventTime ?? "2026-01-01T00:00:02.000Z",
      eventType: "object.created",
      objectKey: options.objectKey,
      providerId: "s3_primary",
      size: options.size,
    },
  });
  const result = await routeStoredS3CoordinatorUploadEvent({
    bucket: "media",
    client: headObjectClient(options.headObjectInputs, options.size),
    event,
    independent: options.independent,
    providerId: "s3_primary",
    sessionId: session.sessionId,
    store: options.store,
  });

  if (result.status !== "committed") {
    throw new Error("expected routed upload event to commit");
  }

  return result;
}

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
