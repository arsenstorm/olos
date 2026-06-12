import {
  type HeadObjectCommand,
  type HeadObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  renderMediaPlaylist,
  resolveBlockingHlsManifestArtifactResponse,
  resolveHlsManifestArtifactResponse,
} from "olos/hls";
import {
  createCoordinatorPipeline,
  createMemoryCoordinatorStore,
} from "olos/protocol";
import {
  createRuntimeObjectLowLatencyManifestOptions,
  createRuntimeObjectLowLatencyProfile,
  createRuntimeObjectLowLatencyPublisherDefaults,
  createRuntimeObjectLowLatencyPublisherOptions,
  createRuntimePublisherObjectPlan,
  type RuntimePublisherObjectPlan,
  type RuntimePublisherPlannedObjectKind,
  resolveRuntimePublisherObjectExpiry,
} from "olos/runtime";
import {
  commitStoredS3CoordinatorUpload,
  issueStoredS3CoordinatorUploadGrant,
  normalizeS3ObjectCreatedEvents,
  routeStoredS3CoordinatorUploadEvent,
  runNextStoredS3PublisherUploadStep,
  type S3HeadObjectClient,
} from "olos/s3";
import { normalizeUploadEvent } from "olos/state";
import type { Pathway, Session } from "olos/types";
import { assertCursor } from "olos/validation";
import { describe, expect, test } from "vitest";

const latency = createRuntimeObjectLowLatencyProfile();
const manifestOptions = createRuntimeObjectLowLatencyManifestOptions(latency);
const publisherOptions = createRuntimeObjectLowLatencyPublisherOptions(latency);
const publisherDefaults = createRuntimeObjectLowLatencyPublisherDefaults({
  contentType: "video/mp4",
  init: {
    duration: 1,
    maxBytes: 2048,
  },
  part: {
    maxBytes: 25_000,
  },
  profile: latency,
  segment: {
    maxBytes: 100_000,
  },
});

const session = {
  createdAt: "2026-01-01T00:00:00.000Z",
  epoch: 1,
  latencyProfile: latency.latencyProfile,
  olos: "1.0",
  partTarget: latency.partTarget,
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
  segmentTarget: latency.segmentTarget,
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

const publishNow = "2026-01-01T00:00:00.000Z";
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
      commitId: issued.initPlan.commitId,
      committedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: issued.initPlan.slot.slotId,
      store,
    });
    const segmentCommit = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: headObjectClient(headObjectInputs, 98_304),
      commitId: issued.segmentPlan.commitId,
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: true,
      manifest: {
        allowedMediaOrigins: ["https://media.example.com"],
        ...manifestOptions.manifest,
        response: manifestOptions.response,
      },
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: issued.segmentPlan.slot.slotId,
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
      `#EXT-X-MAP:URI="${issued.initPlan.slot.deliveryUrl}"`
    );
    expect(media?.response.body).toContain(issued.segmentPlan.slot.deliveryUrl);
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: issued.initPlan.slot.objectKey,
      },
      {
        Bucket: "media",
        Key: issued.segmentPlan.slot.objectKey,
      },
    ]);
  });

  test("publishes a planned S3 publisher step into stored HLS state", async () => {
    const headObjectInputs: unknown[] = [];
    const uploadedUrls: string[] = [];
    const store = await createStoredPipeline();
    const initPlan = createUploadPlan({
      kind: "init",
      maxBytes: 2048,
      mediaSequenceNumber: 0,
    });
    const init = await issuePlannedUploadGrant({ plan: initPlan, store });

    expect(init.status).toBe("saved");

    await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: headObjectClient(headObjectInputs, 1024),
      commitId: initPlan.commitId,
      committedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: initPlan.slot.slotId,
      store,
    });

    const storedBeforeStep = await store.load(session.sessionId);

    const step = await runNextStoredS3PublisherUploadStep({
      baseUrl: "https://media.example.com",
      bucket: "media",
      client: createS3Client(),
      committedAt: "2026-01-01T00:00:02.000Z",
      cursorWindow: storedBeforeStep?.state.cursor?.window,
      defaults: publisherDefaults,
      headObjectClient: headObjectClient(headObjectInputs, 98_304),
      independent: true,
      manifest: {
        allowedMediaOrigins: ["https://media.example.com"],
        ...manifestOptions.manifest,
      },
      now: publishNow,
      objectKeyPrefix: "media",
      providerId: "s3_primary",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      sessionId: session.sessionId,
      startMediaSequenceNumber: 3810,
      store,
      minTtlSeconds: publisherOptions.expiry.minTtlSeconds,
      targetLatency: publisherOptions.expiry.targetLatency,
      upload: (grant, plan) => {
        uploadedUrls.push(grant.url);
        expect(grant.slotId).toBe(plan.slot.slotId);

        return Promise.resolve();
      },
    });

    expect(step.position).toEqual({
      kind: "segment",
      mediaSequenceNumber: 3810,
    });
    expect(step.status).toBe("committed");
    expect(step.expiry).toEqual({
      expiresAt: "2026-01-01T00:00:05.000Z",
      ttlSeconds: 5,
    });

    if (step.status !== "committed") {
      throw new Error("expected planned publisher step to commit");
    }

    const stored = await store.load(session.sessionId);
    const cursor = stored?.state.cursor;
    const media = resolveHlsManifestArtifactResponse(
      step.commit.manifest?.artifacts ?? [],
      "/v1/live/session_1/v1080/media.m3u8"
    );

    if (cursor === undefined) {
      throw new Error("expected stored cursor");
    }

    assertCursor(cursor);

    expect(cursor.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(media?.body).toContain(step.plan.slot.deliveryUrl);
    expect(uploadedUrls).toHaveLength(1);
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: initPlan.slot.objectKey,
      },
      {
        Bucket: "media",
        Key: step.plan.slot.objectKey,
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
      commitId: issued.initPlan.commitId,
      committedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: issued.initPlan.slot.slotId,
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
                eTag: `"${issued.segmentPlan.slot.objectKey}"`,
                key: issued.segmentPlan.slot.objectKey,
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
        ...manifestOptions.manifest,
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
      ...manifestOptions.manifest,
      renditionId: "v1080",
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

    expect(playlist).toContain(issued.segmentPlan.slot.deliveryUrl);
    expect(response?.body).toContain(issued.segmentPlan.slot.deliveryUrl);
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: issued.initPlan.slot.objectKey,
      },
      {
        Bucket: "media",
        Key: issued.segmentPlan.slot.objectKey,
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
      commitId: issued.initPlan.commitId,
      committedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: issued.initPlan.slot.slotId,
      store,
    });
    await routeUploadEvent({
      headObjectInputs,
      independent: true,
      objectKey: issued.segmentPlan.slot.objectKey,
      size: 98_304,
      store,
    });
    await routeUploadEvent({
      eventId: "evt_3811_0",
      headObjectInputs,
      independent: true,
      objectKey: issued.part0Plan.slot.objectKey,
      size: 24_000,
      store,
    });
    await routeUploadEvent({
      eventId: "evt_3811_1",
      eventTime: "2026-01-01T00:00:02.500Z",
      headObjectInputs,
      objectKey: issued.part1Plan.slot.objectKey,
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
      ...manifestOptions.manifest,
      renditionId: "v1080",
    });

    expect(cursor.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3811,
      lastPartNumber: 1,
    });
    expect(playlist).toContain("#EXT-X-PART-INF:PART-TARGET=0.500");
    expect(playlist).toContain(
      `#EXT-X-PART:DURATION=0.500,INDEPENDENT=YES,URI="${issued.part0Plan.slot.deliveryUrl}"`
    );
    expect(playlist).toContain(
      `#EXT-X-PART:DURATION=0.500,URI="${issued.part1Plan.slot.deliveryUrl}"`
    );
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: issued.initPlan.slot.objectKey,
      },
      {
        Bucket: "media",
        Key: issued.segmentPlan.slot.objectKey,
      },
      {
        Bucket: "media",
        Key: issued.part0Plan.slot.objectKey,
      },
      {
        Bucket: "media",
        Key: issued.part1Plan.slot.objectKey,
      },
    ]);
  });

  test("waits for cursor advancement before resolving a blocking media playlist", async () => {
    const headObjectInputs: unknown[] = [];
    const store = await createStoredPipeline();
    const issued = await issueBlockingReloadSlots(store);

    for (const issue of [issued.init, issued.nextSegment, issued.segment]) {
      expect(issue.status).toBe("saved");
    }

    await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: headObjectClient(headObjectInputs, 1024),
      commitId: issued.initPlan.commitId,
      committedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: issued.initPlan.slot.slotId,
      store,
    });
    await routeUploadEvent({
      headObjectInputs,
      independent: true,
      objectKey: issued.segmentPlan.slot.objectKey,
      size: 98_304,
      store,
    });

    const stored = await store.load(session.sessionId);
    const cursor = stored?.state.cursor;

    if (cursor === undefined) {
      throw new Error("expected stored cursor");
    }

    assertCursor(cursor);
    expect(cursor.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });

    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest: {
        allowedMediaOrigins: ["https://media.example.com"],
        ...manifestOptions.manifest,
      },
      requestUrl: "/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3811",
      session,
      timeoutMs: manifestOptions.blockingReloadTimeoutMs,
      waitForCursor: async () => {
        await routeUploadEvent({
          eventId: "evt_3811",
          eventTime: "2026-01-01T00:00:04.000Z",
          headObjectInputs,
          independent: true,
          objectKey: issued.nextSegmentPlan.slot.objectKey,
          size: 99_000,
          store,
        });

        const next = await store.load(session.sessionId);
        const nextCursor = next?.state.cursor;

        if (nextCursor === undefined) {
          throw new Error("expected advanced cursor");
        }

        return nextCursor;
      },
    });

    expect(result.status).toBe("ready");

    if (result.status !== "ready") {
      throw new Error("expected blocking response to resolve");
    }

    expect(result.cursor.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3811,
    });
    expect(result.response.body).toContain(
      issued.nextSegmentPlan.slot.deliveryUrl
    );
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: issued.initPlan.slot.objectKey,
      },
      {
        Bucket: "media",
        Key: issued.segmentPlan.slot.objectKey,
      },
      {
        Bucket: "media",
        Key: issued.nextSegmentPlan.slot.objectKey,
      },
    ]);
  });

  test("publishes multiple S3 renditions into coherent HLS manifests", async () => {
    const headObjectInputs: unknown[] = [];
    const store = await createStoredPipeline(multiRenditionSession);
    const issued = await issueMultiRenditionSlots(store);

    for (const issue of [
      issued.v1080Init,
      issued.v1080Segment,
      issued.v720Init,
      issued.v720Segment,
    ]) {
      expect(issue.status).toBe("saved");
    }

    await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: headObjectClient(headObjectInputs, 1024),
      commitId: issued.v1080InitPlan.commitId,
      committedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      sessionId: multiRenditionSession.sessionId,
      slotId: issued.v1080InitPlan.slot.slotId,
      store,
    });
    await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: headObjectClient(headObjectInputs, 768),
      commitId: issued.v720InitPlan.commitId,
      committedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      sessionId: multiRenditionSession.sessionId,
      slotId: issued.v720InitPlan.slot.slotId,
      store,
    });
    await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: headObjectClient(headObjectInputs, 98_304),
      commitId: issued.v1080SegmentPlan.commitId,
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: true,
      providerId: "s3_primary",
      sessionId: multiRenditionSession.sessionId,
      slotId: issued.v1080SegmentPlan.slot.slotId,
      store,
    });
    const segmentCommit = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: headObjectClient(headObjectInputs, 64_000),
      commitId: issued.v720SegmentPlan.commitId,
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: true,
      manifest: {
        allowedMediaOrigins: ["https://media.example.com"],
        ...manifestOptions.manifest,
      },
      providerId: "s3_primary",
      sessionId: multiRenditionSession.sessionId,
      slotId: issued.v720SegmentPlan.slot.slotId,
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
      `#EXT-X-MAP:URI="${issued.v1080InitPlan.slot.deliveryUrl}"`
    );
    expect(v1080?.body).toContain(issued.v1080SegmentPlan.slot.deliveryUrl);
    expect(v720?.body).toContain(
      `#EXT-X-MAP:URI="${issued.v720InitPlan.slot.deliveryUrl}"`
    );
    expect(v720?.body).toContain(issued.v720SegmentPlan.slot.deliveryUrl);
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: issued.v1080InitPlan.slot.objectKey,
      },
      {
        Bucket: "media",
        Key: issued.v720InitPlan.slot.objectKey,
      },
      {
        Bucket: "media",
        Key: issued.v1080SegmentPlan.slot.objectKey,
      },
      {
        Bucket: "media",
        Key: issued.v720SegmentPlan.slot.objectKey,
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
  const initPlan = createUploadPlan({
    kind: "init",
    maxBytes: 2048,
    mediaSequenceNumber: 0,
  });
  const segmentPlan = createUploadPlan({
    kind: "segment",
    maxBytes: 100_000,
    mediaSequenceNumber: 3810,
  });
  const init = await issuePlannedUploadGrant({ plan: initPlan, store });
  const segment = await issuePlannedUploadGrant({ plan: segmentPlan, store });

  return { init, initPlan, segment, segmentPlan };
}

async function issueLowLatencySlots(
  store: ReturnType<typeof createMemoryCoordinatorStore>
) {
  const issued = await issueInitAndSegment(store);
  const part0Plan = createUploadPlan({
    kind: "part",
    maxBytes: 25_000,
    mediaSequenceNumber: 3811,
    partNumber: 0,
  });
  const part1Plan = createUploadPlan({
    kind: "part",
    maxBytes: 25_000,
    mediaSequenceNumber: 3811,
    partNumber: 1,
  });
  const part0 = await issuePlannedUploadGrant({ plan: part0Plan, store });
  const part1 = await issuePlannedUploadGrant({ plan: part1Plan, store });

  return { ...issued, part0, part0Plan, part1, part1Plan };
}

async function issueBlockingReloadSlots(
  store: ReturnType<typeof createMemoryCoordinatorStore>
) {
  const issued = await issueInitAndSegment(store);
  const nextSegmentPlan = createUploadPlan({
    kind: "segment",
    maxBytes: 100_000,
    mediaSequenceNumber: 3811,
  });
  const nextSegment = await issuePlannedUploadGrant({
    plan: nextSegmentPlan,
    store,
  });

  return { ...issued, nextSegment, nextSegmentPlan };
}

async function issueMultiRenditionSlots(
  store: ReturnType<typeof createMemoryCoordinatorStore>
) {
  const v1080InitPlan = createUploadPlan({
    kind: "init",
    maxBytes: 2048,
    mediaSequenceNumber: 0,
    renditionId: "v1080",
  });
  const v720InitPlan = createUploadPlan({
    kind: "init",
    maxBytes: 2048,
    mediaSequenceNumber: 0,
    renditionId: "v720",
  });
  const v1080SegmentPlan = createUploadPlan({
    kind: "segment",
    maxBytes: 100_000,
    mediaSequenceNumber: 3810,
    renditionId: "v1080",
  });
  const v720SegmentPlan = createUploadPlan({
    kind: "segment",
    maxBytes: 75_000,
    mediaSequenceNumber: 3810,
    renditionId: "v720",
  });
  const v1080Init = await issuePlannedUploadGrant({
    plan: v1080InitPlan,
    sessionId: multiRenditionSession.sessionId,
    store,
  });
  const v720Init = await issuePlannedUploadGrant({
    plan: v720InitPlan,
    sessionId: multiRenditionSession.sessionId,
    store,
  });
  const v1080Segment = await issuePlannedUploadGrant({
    plan: v1080SegmentPlan,
    sessionId: multiRenditionSession.sessionId,
    store,
  });
  const v720Segment = await issuePlannedUploadGrant({
    plan: v720SegmentPlan,
    sessionId: multiRenditionSession.sessionId,
    store,
  });

  return {
    v1080Init,
    v1080InitPlan,
    v1080Segment,
    v1080SegmentPlan,
    v720Init,
    v720InitPlan,
    v720Segment,
    v720SegmentPlan,
  };
}

function createUploadPlan(options: {
  kind: RuntimePublisherPlannedObjectKind;
  maxBytes: number;
  mediaSequenceNumber: number;
  partNumber?: number;
  renditionId?: string;
}): RuntimePublisherObjectPlan {
  const duration = plannedDuration(options.kind);
  const expiry = resolveRuntimePublisherObjectExpiry({
    duration,
    minTtlSeconds: publisherOptions.expiry.minTtlSeconds,
    now: publishNow,
    targetLatency: publisherOptions.expiry.targetLatency,
  });

  return createRuntimePublisherObjectPlan({
    baseUrl: "https://media.example.com",
    contentType: "video/mp4",
    duration,
    expiresAt: expiry.expiresAt,
    extension: options.kind === "init" ? "mp4" : "m4s",
    kind: options.kind,
    maxBytes: options.maxBytes,
    mediaSequenceNumber: options.mediaSequenceNumber,
    objectKeyPrefix: "media",
    partNumber: options.partNumber,
    publicationMode: "direct-public",
    publisherInstanceId: "pub_1",
    renditionId: options.renditionId ?? "v1080",
  });
}

function plannedDuration(kind: RuntimePublisherPlannedObjectKind): number {
  if (kind === "part") {
    return 0.5;
  }

  return kind === "init" ? 1 : 2;
}

function issuePlannedUploadGrant(options: {
  plan: RuntimePublisherObjectPlan;
  sessionId?: string;
  store: ReturnType<typeof createMemoryCoordinatorStore>;
}) {
  const expiry = resolveRuntimePublisherObjectExpiry({
    duration: options.plan.slot.duration,
    minTtlSeconds: publisherOptions.expiry.minTtlSeconds,
    now: publishNow,
    targetLatency: publisherOptions.expiry.targetLatency,
  });

  return issueStoredS3CoordinatorUploadGrant({
    bucket: "media",
    client: createS3Client(),
    expiresInSeconds: expiry.ttlSeconds,
    now: publishNow,
    sessionId: options.sessionId ?? session.sessionId,
    ...options.plan.slot,
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
