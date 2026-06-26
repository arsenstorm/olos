import {
  renderMediaPlaylist,
  resolveBlockingHlsManifestArtifactResponse,
  resolveHlsManifestArtifactResponse,
} from "@arsenstorm/olos/hls";
import {
  createCoordinatorPipeline,
  createMemoryCoordinatorStore,
} from "@arsenstorm/olos/protocol";
import {
  createRuntimeObjectLowLatencyManifestOptions,
  createRuntimeObjectLowLatencyProfile,
  createRuntimeObjectLowLatencyPublisherDefaults,
  createRuntimeObjectLowLatencyPublisherOptions,
  createRuntimePublisherObjectPlan,
  planStoredCoordinatorRetention,
  type RuntimePublisherObjectPlan,
  type RuntimePublisherPlannedObjectKind,
  resolveRuntimePublisherObjectExpiry,
} from "@arsenstorm/olos/runtime";
import {
  commitStoredS3CoordinatorUpload,
  deleteRetiredS3CoordinatorObjects,
  issueStoredS3CoordinatorUploadGrant,
  normalizeS3ObjectCreatedEvents,
  planStoredS3CoordinatorReconciliation,
  reconcileStoredS3CoordinatorUploads,
  routeStoredS3CoordinatorUploadEvent,
  runNextStoredS3PublisherUploadStep,
  type StoredS3PublisherUploadStepSummary,
  summarizeStoredS3CoordinatorUploadReconciliation,
  summarizeStoredS3PublisherUploadStep,
} from "@arsenstorm/olos/s3";
import { normalizeUploadEvent } from "@arsenstorm/olos/state";
import type { Pathway, Session } from "@arsenstorm/olos/types";
import { assertCursor } from "@arsenstorm/olos/validation";
import { describe, expect, test } from "vitest";
import {
  createTestDeleteObjectClient,
  createTestHeadObjectClient,
  createTestHeadObjectClientFor,
  createTestS3Client,
} from "./fake-s3-clients";

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
      client: createTestHeadObjectClient(headObjectInputs, 1024),
      commitId: issued.initPlan.commitId,
      committedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: issued.initPlan.slot.slotId,
      store,
    });
    const segmentCommit = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: createTestHeadObjectClient(headObjectInputs, 98_304),
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
      client: createTestHeadObjectClient(headObjectInputs, 1024),
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
      client: createTestS3Client(),
      committedAt: "2026-01-01T00:00:02.000Z",
      cursorWindow: storedBeforeStep?.state.cursor?.window,
      defaults: publisherDefaults,
      headObjectClient: createTestHeadObjectClient(headObjectInputs, 98_304),
      independent: true,
      manifest: {
        allowedMediaOrigins: ["https://media.example.com"],
        ...manifestOptions.manifest,
      },
      now: publishNow,
      objectKeyNonce: "slot_next_s3811",
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

  test("runs the next-object S3 publisher loop into HLS state", async () => {
    const headObjectInputs: unknown[] = [];
    const uploadedUrls: string[] = [];
    const summaries: StoredS3PublisherUploadStepSummary[] = [];
    const store = await createStoredPipeline();

    const init = await runNextStoredS3PublisherUploadStep({
      ...publisherLoopOptions({
        headObjectInputs,
        size: 1024,
        store,
        uploadedUrls,
      }),
      committedAt: "2026-01-01T00:00:01.000Z",
      initPublished: false,
    });

    summaries.push(summarizeStoredS3PublisherUploadStep(init));
    expect(init.status).toBe("committed");
    expect(init.position).toEqual({
      kind: "init",
      mediaSequenceNumber: 0,
    });

    let stored = await store.load(session.sessionId);
    const firstSegment = await runNextStoredS3PublisherUploadStep({
      ...publisherLoopOptions({
        headObjectInputs,
        size: 98_304,
        store,
        uploadedUrls,
      }),
      committedAt: "2026-01-01T00:00:02.000Z",
      cursorWindow: stored?.state.cursor?.window,
    });

    summaries.push(summarizeStoredS3PublisherUploadStep(firstSegment));
    expect(firstSegment.status).toBe("committed");
    expect(firstSegment.position).toEqual({
      kind: "segment",
      mediaSequenceNumber: 3810,
    });

    stored = await store.load(session.sessionId);
    const nextSegment = await runNextStoredS3PublisherUploadStep({
      ...publisherLoopOptions({
        headObjectInputs,
        size: 99_000,
        store,
        uploadedUrls,
      }),
      committedAt: "2026-01-01T00:00:04.000Z",
      cursorWindow: stored?.state.cursor?.window,
    });

    summaries.push(summarizeStoredS3PublisherUploadStep(nextSegment));
    expect(nextSegment.status).toBe("committed");
    expect(nextSegment.position).toEqual({
      kind: "segment",
      mediaSequenceNumber: 3811,
    });

    if (nextSegment.status !== "committed") {
      throw new Error("expected next segment to commit");
    }

    stored = await store.load(session.sessionId);
    const cursor = stored?.state.cursor;

    if (cursor === undefined) {
      throw new Error("expected stored cursor");
    }

    assertCursor(cursor);

    const media = resolveHlsManifestArtifactResponse(
      nextSegment.commit.manifest?.artifacts ?? [],
      "/v1/live/session_1/v1080/media.m3u8"
    );

    expect(cursor.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3811,
    });
    expect(media?.body).toContain(init.plan.slot.deliveryUrl);
    expect(media?.body).toContain(firstSegment.plan.slot.deliveryUrl);
    expect(media?.body).toContain(nextSegment.plan.slot.deliveryUrl);
    expect(uploadedUrls).toHaveLength(3);
    expect(summaries).toEqual([
      {
        commitId: "commit_init_v1080",
        commitStatus: "committed",
        objectKey: init.plan.slot.objectKey,
        ok: true,
        slotId: "slot_init_v1080",
        status: "committed",
      },
      {
        commitId: "commit_v1080_s3810",
        commitStatus: "committed",
        objectKey: firstSegment.plan.slot.objectKey,
        ok: true,
        slotId: "slot_v1080_s3810",
        status: "committed",
      },
      {
        commitId: "commit_v1080_s3811",
        commitStatus: "committed",
        objectKey: nextSegment.plan.slot.objectKey,
        ok: true,
        slotId: "slot_v1080_s3811",
        status: "committed",
      },
    ]);
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: init.plan.slot.objectKey,
      },
      {
        Bucket: "media",
        Key: firstSegment.plan.slot.objectKey,
      },
      {
        Bucket: "media",
        Key: nextSegment.plan.slot.objectKey,
      },
    ]);
  });

  test("runs recovery and retention as app-owned jobs", async () => {
    const deletedObjects: unknown[] = [];
    const headObjectInputs: unknown[] = [];
    const store = await createStoredPipeline();
    const issued = await issueBlockingReloadSlots(store);
    const thirdSegmentPlan = createUploadPlan({
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3812,
    });
    const thirdSegment = await issuePlannedUploadGrant({
      plan: thirdSegmentPlan,
      store,
    });

    for (const issue of [
      issued.init,
      issued.segment,
      issued.nextSegment,
      thirdSegment,
    ]) {
      expect(issue.status).toBe("saved");
    }

    const plan = await planStoredS3CoordinatorReconciliation({
      sessionId: session.sessionId,
      store,
    });
    const commitIds = new Map([
      [issued.initPlan.slot.slotId, issued.initPlan.commitId],
      [issued.segmentPlan.slot.slotId, issued.segmentPlan.commitId],
      [issued.nextSegmentPlan.slot.slotId, issued.nextSegmentPlan.commitId],
      [thirdSegmentPlan.slot.slotId, thirdSegmentPlan.commitId],
    ]);

    expect(plan.status).toBe("planned");
    if (plan.status !== "planned") {
      throw new Error("expected reconciliation plan");
    }

    const recovered = await reconcileStoredS3CoordinatorUploads({
      bucket: "media",
      client: createTestHeadObjectClientFor(
        new Map([
          [issued.initPlan.slot.objectKey, 1024],
          [issued.segmentPlan.slot.objectKey, 98_304],
          [issued.nextSegmentPlan.slot.objectKey, 99_000],
          [thirdSegmentPlan.slot.objectKey, 99_500],
        ]),
        headObjectInputs
      ),
      commitId: (slot) => {
        const commitId = commitIds.get(slot.slotId);

        if (commitId === undefined) {
          throw new Error(`missing commit id for ${slot.slotId}`);
        }

        return commitId;
      },
      committedAt: (slot) =>
        slot.kind === "init"
          ? "2026-01-01T00:00:01.000Z"
          : `2026-01-01T00:00:0${slot.mediaSequenceNumber - 3808}.000Z`,
      independent: (slot) => slot.kind === "segment",
      maxSegments: 2,
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store,
    });
    const recoveredSummary =
      summarizeStoredS3CoordinatorUploadReconciliation(recovered);
    const snapshot = await store.load(session.sessionId);
    const cursor = snapshot?.state.cursor;

    if (cursor === undefined) {
      throw new Error("expected recovered cursor");
    }

    assertCursor(cursor);

    expect(plan.slotIds).toEqual([
      issued.initPlan.slot.slotId,
      issued.segmentPlan.slot.slotId,
      issued.nextSegmentPlan.slot.slotId,
      thirdSegmentPlan.slot.slotId,
    ]);
    expect(recoveredSummary).toMatchObject({
      committed: 4,
      failed: 0,
      ok: true,
      planned: 4,
    });
    expect(cursor.window).toEqual({
      firstMediaSequenceNumber: 3811,
      lastMediaSequenceNumber: 3812,
    });

    const retention = await planStoredCoordinatorRetention({
      now: "2026-01-01T00:00:08.000Z",
      sessionId: session.sessionId,
      store,
    });

    expect(retention.status).toBe("planned");
    if (retention.status !== "planned") {
      throw new Error("expected retention plan");
    }

    const deleted = await deleteRetiredS3CoordinatorObjects({
      bucket: "media",
      client: createTestDeleteObjectClient(deletedObjects),
      objects: retention.plan.retiredObjects,
    });

    expect(retention.plan.retiredObjects).toEqual([
      {
        commitId: issued.segmentPlan.commitId,
        objectKey: issued.segmentPlan.slot.objectKey,
        slotId: issued.segmentPlan.slot.slotId,
      },
    ]);
    expect(deleted.failedObjects).toEqual([]);
    expect(deleted.deletedObjects).toEqual(retention.plan.retiredObjects);
    expect(deletedObjects).toEqual([
      {
        Bucket: "media",
        Key: issued.segmentPlan.slot.objectKey,
      },
    ]);
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
      {
        Bucket: "media",
        Key: thirdSegmentPlan.slot.objectKey,
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
      client: createTestHeadObjectClient(headObjectInputs, 1024),
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
              bucket: {
                name: "media",
              },
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
      client: createTestHeadObjectClient(
        headObjectInputs,
        event.event.object.size
      ),
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
      client: createTestHeadObjectClient(headObjectInputs, 1024),
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
    expect(latency.targetLatency).toBeLessThanOrEqual(4);
    expect(manifestOptions.response.maxAgeSeconds).toBeLessThanOrEqual(
      latency.targetLatency
    );
    expect(playlist).toContain("#EXT-X-PART-INF:PART-TARGET=0.500");
    expect(playlist).toContain(
      "#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=3.000,HOLD-BACK=3.000"
    );
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
      client: createTestHeadObjectClient(headObjectInputs, 1024),
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
      client: createTestHeadObjectClient(headObjectInputs, 1024),
      commitId: issued.v1080InitPlan.commitId,
      committedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      sessionId: multiRenditionSession.sessionId,
      slotId: issued.v1080InitPlan.slot.slotId,
      store,
    });
    await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: createTestHeadObjectClient(headObjectInputs, 768),
      commitId: issued.v720InitPlan.commitId,
      committedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      sessionId: multiRenditionSession.sessionId,
      slotId: issued.v720InitPlan.slot.slotId,
      store,
    });
    await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: createTestHeadObjectClient(headObjectInputs, 98_304),
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
      client: createTestHeadObjectClient(headObjectInputs, 64_000),
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
    objectKeyNonce: objectKeyNonceForPlan(options),
    objectKeyPrefix: "media",
    partNumber: options.partNumber,
    publicationMode: "direct-public",
    publisherInstanceId: "pub_1",
    renditionId: options.renditionId ?? "v1080",
  });
}

function objectKeyNonceForPlan(options: {
  kind: RuntimePublisherPlannedObjectKind;
  mediaSequenceNumber: number;
  partNumber?: number;
  renditionId?: string;
}): string {
  const renditionId = options.renditionId ?? "v1080";

  if (options.kind === "init") {
    return `slot_${renditionId}_init`;
  }

  if (options.kind === "segment") {
    return `slot_${renditionId}_s${options.mediaSequenceNumber}`;
  }

  return `slot_${renditionId}_s${options.mediaSequenceNumber}_p${options.partNumber}`;
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
    client: createTestS3Client(),
    expiresInSeconds: expiry.ttlSeconds,
    now: publishNow,
    sessionId: options.sessionId ?? session.sessionId,
    ...options.plan.slot,
    store: options.store,
  });
}

function publisherLoopOptions(options: {
  headObjectInputs: unknown[];
  size: number;
  store: ReturnType<typeof createMemoryCoordinatorStore>;
  uploadedUrls: string[];
}) {
  return {
    baseUrl: "https://media.example.com",
    bucket: "media",
    client: createTestS3Client(),
    defaults: publisherDefaults,
    headObjectClient: createTestHeadObjectClient(
      options.headObjectInputs,
      options.size
    ),
    independent: true,
    manifest: {
      allowedMediaOrigins: ["https://media.example.com"],
      ...manifestOptions.manifest,
    },
    minTtlSeconds: publisherOptions.expiry.minTtlSeconds,
    now: publishNow,
    objectKeyNonce: "slot_next_s3810",
    objectKeyPrefix: "media",
    providerId: "s3_primary",
    publicationMode: "direct-public" as const,
    publisherInstanceId: "pub_1",
    renditionId: "v1080",
    sessionId: session.sessionId,
    startMediaSequenceNumber: 3810,
    store: options.store,
    targetLatency: publisherOptions.expiry.targetLatency,
    upload: (grant: { url: string }) => {
      options.uploadedUrls.push(grant.url);

      return Promise.resolve();
    },
  };
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
    client: createTestHeadObjectClient(options.headObjectInputs, options.size),
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
