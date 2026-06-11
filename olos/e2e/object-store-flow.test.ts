import {
  type HeadObjectCommand,
  type HeadObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  renderMediaPlaylist,
  resolveHlsManifestArtifactResponse,
} from "olos/hls";
import {
  createCoordinatorPipeline,
  createMemoryCoordinatorStore,
} from "olos/protocol";
import {
  commitStoredS3CoordinatorUpload,
  issueStoredS3CoordinatorUploadGrant,
  normalizeS3ObjectCreatedEvents,
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

const multiRenditionSession = {
  ...session,
  renditions: [
    session.renditions[0],
    {
      bitrate: 2_800_000,
      codec: "avc1.64001f",
      frameRate: 30,
      height: 720,
      kind: "video",
      renditionId: "v720",
      width: 1280,
    },
  ],
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
      manifest: {
        allowedMediaOrigins: ["https://media.example.com"],
        partTarget: session.partTarget,
        response: {
          maxAgeSeconds: 1,
          targetLatencySeconds: 3,
        },
        segmentTarget: session.segmentTarget,
        targetLatency: 3,
      },
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

    if (segmentCommit.status !== "committed") {
      throw new Error("expected segment commit");
    }

    const master = segmentCommit.manifest?.artifacts.find(
      (artifact) => artifact.path === "/v1/live/session_1/master.m3u8"
    );
    const media = segmentCommit.manifest?.artifacts.find(
      (artifact) => artifact.path === "/v1/live/session_1/v1080/media.m3u8"
    );
    const resolvedMaster =
      segmentCommit.manifest === undefined
        ? undefined
        : resolveHlsManifestArtifactResponse(
            segmentCommit.manifest.artifacts,
            "https://edge.example.com/v1/live/session_1/master.m3u8"
          );
    const resolvedMedia =
      segmentCommit.manifest === undefined
        ? undefined
        : resolveHlsManifestArtifactResponse(
            segmentCommit.manifest.artifacts,
            "/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3810"
          );

    expect(cursor.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(segmentCommit.manifest?.cursor).toEqual(cursor);
    expect(master?.response).toMatchObject({
      headers: {
        "cache-control": "public, max-age=1, must-revalidate",
        "content-type": "application/vnd.apple.mpegurl",
      },
      status: 200,
    });
    expect(master?.response.body).toContain(
      "/v1/live/session_1/v1080/media.m3u8"
    );
    expect(resolvedMaster).toEqual(master?.response);
    expect(media?.response).toMatchObject({
      headers: {
        "cache-control": "public, max-age=1, must-revalidate",
        "content-type": "application/vnd.apple.mpegurl",
      },
      status: 200,
    });
    expect(resolvedMedia).toEqual(media?.response);
    expect(media?.response.body).toContain(
      '#EXT-X-MAP:URI="https://media.example.com/media/v1080/init.mp4"'
    );
    expect(media?.response.body).toContain(
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

    const [event] = normalizeS3ObjectCreatedEvents({
      contentType: "video/mp4",
      payload: {
        Records: [
          {
            eventName: "ObjectCreated:Put",
            eventTime: "2026-01-01T00:00:02.000Z",
            responseElements: {
              "x-amz-request-id": "evt_3810",
            },
            s3: {
              object: {
                eTag: '"media/v1080/3810.m4s"',
                key: "media/v1080/3810.m4s",
                sequencer: "0065A4",
                size: 98_304,
              },
            },
          },
        ],
      },
      providerId: "s3_primary",
    });

    expect(event).toBeDefined();
    expect(event.status).toBe("object_created");
    if (event?.status !== "object_created") {
      throw new Error("expected object-created event");
    }

    const segmentCommit = await routeStoredS3CoordinatorUploadEvent({
      bucket: "media",
      client: headObjectClient(headObjectInputs, event.event.object.size),
      event,
      independent: true,
      manifest: {
        allowedMediaOrigins: ["https://media.example.com"],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
        targetLatency: 3,
      },
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
    const response =
      segmentCommit.status === "committed" && segmentCommit.manifest
        ? resolveHlsManifestArtifactResponse(
            segmentCommit.manifest.artifacts,
            "/v1/live/session_1/v1080/media.m3u8"
          )
        : undefined;

    expect(playlist).toContain(
      "https://media.example.com/media/v1080/3810.m4s"
    );
    expect(response?.body).toContain(
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

  test("publishes multiple S3 renditions into coherent HLS manifests", async () => {
    const headObjectInputs: unknown[] = [];
    const store = await createStoredPipeline(multiRenditionSession);
    const issued = await issueMultiRenditionSlots(store);

    for (const issue of Object.values(issued)) {
      expect(issue.status).toBe("saved");
    }

    await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: headObjectClient(headObjectInputs, 1024),
      commitId: "commit_v1080_init",
      committedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      sessionId: multiRenditionSession.sessionId,
      slotId: "slot_v1080_init",
      store,
    });
    await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: headObjectClient(headObjectInputs, 768),
      commitId: "commit_v720_init",
      committedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      sessionId: multiRenditionSession.sessionId,
      slotId: "slot_v720_init",
      store,
    });
    await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: headObjectClient(headObjectInputs, 98_304),
      commitId: "commit_v1080_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: true,
      providerId: "s3_primary",
      sessionId: multiRenditionSession.sessionId,
      slotId: "slot_v1080_3810",
      store,
    });
    const segmentCommit = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: headObjectClient(headObjectInputs, 64_000),
      commitId: "commit_v720_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: true,
      manifest: {
        allowedMediaOrigins: ["https://media.example.com"],
        partTarget: multiRenditionSession.partTarget,
        segmentTarget: multiRenditionSession.segmentTarget,
        targetLatency: 3,
      },
      providerId: "s3_primary",
      sessionId: multiRenditionSession.sessionId,
      slotId: "slot_v720_3810",
      store,
    });

    expect(segmentCommit.status).toBe("committed");

    if (segmentCommit.status !== "committed") {
      throw new Error("expected segment commit");
    }

    const master = resolveHlsManifestArtifactResponse(
      segmentCommit.manifest?.artifacts ?? [],
      "/v1/live/session_1/master.m3u8"
    );
    const v1080 = resolveHlsManifestArtifactResponse(
      segmentCommit.manifest?.artifacts ?? [],
      "/v1/live/session_1/v1080/media.m3u8"
    );
    const v720 = resolveHlsManifestArtifactResponse(
      segmentCommit.manifest?.artifacts ?? [],
      "/v1/live/session_1/v720/media.m3u8"
    );

    expect(
      segmentCommit.manifest?.artifacts.map((artifact) => artifact.path)
    ).toEqual([
      "/v1/live/session_1/master.m3u8",
      "/v1/live/session_1/v1080/media.m3u8",
      "/v1/live/session_1/v720/media.m3u8",
    ]);
    expect(master?.body).toContain("/v1/live/session_1/v1080/media.m3u8");
    expect(master?.body).toContain("/v1/live/session_1/v720/media.m3u8");
    expect(v1080?.body).toContain(
      '#EXT-X-MAP:URI="https://media.example.com/media/v1080/init.mp4"'
    );
    expect(v1080?.body).toContain(
      "https://media.example.com/media/v1080/3810.m4s"
    );
    expect(v720?.body).toContain(
      '#EXT-X-MAP:URI="https://media.example.com/media/v720/init.mp4"'
    );
    expect(v720?.body).toContain(
      "https://media.example.com/media/v720/3810.m4s"
    );
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/v1080/init.mp4",
      },
      {
        Bucket: "media",
        Key: "media/v720/init.mp4",
      },
      {
        Bucket: "media",
        Key: "media/v1080/3810.m4s",
      },
      {
        Bucket: "media",
        Key: "media/v720/3810.m4s",
      },
    ]);
  });
});

async function createStoredPipeline(activeSession: Session = session) {
  const store = createMemoryCoordinatorStore();
  await store.save({
    sessionId: activeSession.sessionId,
    state: createCoordinatorPipeline({ pathways, session: activeSession }),
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

async function issueMultiRenditionSlots(
  store: ReturnType<typeof createMemoryCoordinatorStore>
) {
  const v1080Init = await issueRenditionUploadSlot({
    deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
    duration: 1,
    kind: "init",
    maxBytes: 2048,
    mediaSequenceNumber: 0,
    objectKey: "media/v1080/init.mp4",
    renditionId: "v1080",
    slotId: "slot_v1080_init",
    store,
  });
  const v720Init = await issueRenditionUploadSlot({
    deliveryUrl: "https://media.example.com/media/v720/init.mp4",
    duration: 1,
    kind: "init",
    maxBytes: 2048,
    mediaSequenceNumber: 0,
    objectKey: "media/v720/init.mp4",
    renditionId: "v720",
    slotId: "slot_v720_init",
    store,
  });
  const v1080Segment = await issueRenditionUploadSlot({
    deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
    duration: 2,
    kind: "segment",
    maxBytes: 100_000,
    mediaSequenceNumber: 3810,
    objectKey: "media/v1080/3810.m4s",
    renditionId: "v1080",
    slotId: "slot_v1080_3810",
    store,
  });
  const v720Segment = await issueRenditionUploadSlot({
    deliveryUrl: "https://media.example.com/media/v720/3810.m4s",
    duration: 2,
    kind: "segment",
    maxBytes: 75_000,
    mediaSequenceNumber: 3810,
    objectKey: "media/v720/3810.m4s",
    renditionId: "v720",
    slotId: "slot_v720_3810",
    store,
  });

  return { v1080Init, v1080Segment, v720Init, v720Segment };
}

function issueRenditionUploadSlot(options: {
  deliveryUrl: string;
  duration: number;
  kind: "init" | "segment";
  maxBytes: number;
  mediaSequenceNumber: number;
  objectKey: string;
  renditionId: string;
  slotId: string;
  store: ReturnType<typeof createMemoryCoordinatorStore>;
}) {
  return issueStoredS3CoordinatorUploadGrant({
    bucket: "media",
    client: createS3Client(),
    contentType: "video/mp4",
    deliveryUrl: options.deliveryUrl,
    duration: options.duration,
    expiresAt: "2026-01-01T00:00:05.000Z",
    expiresInSeconds: 3,
    kind: options.kind,
    maxBytes: options.maxBytes,
    mediaSequenceNumber: options.mediaSequenceNumber,
    now: "2026-01-01T00:00:00.000Z",
    objectKey: options.objectKey,
    publicationMode: "direct-public",
    publisherInstanceId: "pub_1",
    renditionId: options.renditionId,
    sessionId: multiRenditionSession.sessionId,
    slotId: options.slotId,
    store: options.store,
  });
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
