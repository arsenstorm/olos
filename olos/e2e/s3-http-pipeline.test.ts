import {
  type DeleteObjectCommand,
  type DeleteObjectCommandOutput,
  type HeadObjectCommand,
  type HeadObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import { createMemoryCoordinatorStore } from "olos/protocol";
import {
  createMemoryRuntimeCursorNotifier,
  createRuntimeObjectLowLatencyManifestOptions,
  createRuntimeObjectLowLatencyProfile,
} from "olos/runtime";
import {
  createStoredS3CoordinatorRuntimeHandler,
  type S3DeleteObjectClient,
  type S3HeadObjectClient,
} from "olos/s3";
import type { Pathway, Session } from "olos/types";
import { describe, expect, test } from "vitest";

const latency = createRuntimeObjectLowLatencyProfile();
const manifestOptions = createRuntimeObjectLowLatencyManifestOptions(latency);

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

describe("S3 HTTP pipeline", () => {
  test("publishes and serves a live HLS session through the Fetch handler", async () => {
    const headObjectInputs: unknown[] = [];
    const notifier = createMemoryRuntimeCursorNotifier();
    const store = createMemoryCoordinatorStore();
    let waits = 0;
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      blockingReload: {
        timeoutMs: 1000,
        waitForCursor: (context) => {
          waits += 1;
          return notifier.waitForCursor(context);
        },
      },
      bucket: "media",
      client: createS3Client(),
      cursorNotifier: notifier,
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        {
          "media/v1080/3810.m4s": 98_304,
          "media/v1080/3811.m4s": 98_304,
          "media/v1080/init.mp4": 1024,
        },
        headObjectInputs
      ),
      providerId: "s3_primary",
      response: manifestOptions.response,
      store,
      ...manifestOptions.manifest,
    });

    const created = await handle(
      jsonRequest("https://edge.example.com/sessions", { pathways, session })
    );
    const initGrant = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
          duration: 1,
          kind: "init",
          maxBytes: 2048,
          mediaSequenceNumber: 0,
          objectKey: "media/v1080/init.mp4",
          slotId: "slot_init",
        })
      )
    );
    const segmentGrant = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "media/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );
    const initCommit = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/commits", {
        commitId: "commit_init",
        committedAt: "2026-01-01T00:00:01.000Z",
        slotId: "slot_init",
      })
    );
    const segmentCommit = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/upload-slots/slot_3810/complete",
        {
          commitId: "commit_3810",
          committedAt: "2026-01-01T00:00:02.000Z",
          etag: '"publisher-hint"',
          independent: true,
          objectKey: "media/v1080/3810.m4s",
          size: 1,
        }
      )
    );
    const master = await handle(
      new Request("https://edge.example.com/v1/live/session_1/master.m3u8")
    );
    const media = await handle(
      new Request("https://edge.example.com/v1/live/session_1/v1080/media.m3u8")
    );
    const initGrantBody = (await initGrant.json()) as {
      grant: {
        requiredHeaders: Record<string, string>;
      };
    };
    const mediaBody = await media.text();

    expect(created.status).toBe(201);
    expect(initGrant.status).toBe(201);
    expect(segmentGrant.status).toBe(201);
    expect(initCommit.status).toBe(201);
    expect(segmentCommit.status).toBe(201);
    expect(master.status).toBe(200);
    expect(await master.text()).toContain(
      "/v1/live/session_1/v1080/media.m3u8"
    );
    expect(media.status).toBe(200);
    expect(media.headers.get("cache-control")).toBe(
      "public, max-age=1, must-revalidate"
    );
    expect(initGrantBody.grant.requiredHeaders).toMatchObject({
      "x-amz-meta-olos-slot-id": "slot_init",
      "x-olos-slot-id": "slot_init",
    });
    expect(mediaBody).toContain("#EXT-X-MEDIA-SEQUENCE:3810");
    expect(mediaBody).toContain("#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES");
    expect(mediaBody).toContain(
      "https://media.example.com/media/v1080/3810.m4s"
    );

    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/3811.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3811,
          objectKey: "media/v1080/3811.m4s",
          slotId: "slot_3811",
        })
      )
    );

    const pendingReload = handle(
      new Request(
        "https://edge.example.com/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3811"
      )
    );

    await waitFor(() => waits === 1);

    const nextCommit = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/commits", {
        commitId: "commit_3811",
        committedAt: "2026-01-01T00:00:03.000Z",
        slotId: "slot_3811",
      })
    );
    const reloaded = await pendingReload;
    const reloadedBody = await reloaded.text();

    expect(nextCommit.status).toBe(201);
    expect(reloaded.status).toBe(200);
    expect(reloadedBody).toContain("#EXT-X-MEDIA-SEQUENCE:3810");
    expect(reloadedBody).toContain(
      "https://media.example.com/media/v1080/3811.m4s"
    );
    expect(headObjectInputs).toEqual([
      { Bucket: "media", Key: "media/v1080/init.mp4" },
      { Bucket: "media", Key: "media/v1080/3810.m4s" },
      { Bucket: "media", Key: "media/v1080/3811.m4s" },
    ]);
  });

  test("commits S3 object-created events through the Fetch handler", async () => {
    const headObjectInputs: unknown[] = [];
    const notifier = createMemoryRuntimeCursorNotifier();
    const store = createMemoryCoordinatorStore();
    let waits = 0;
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      blockingReload: {
        timeoutMs: 1000,
        waitForCursor: (context) => {
          waits += 1;
          return notifier.waitForCursor(context);
        },
      },
      bucket: "media",
      client: createS3Client(),
      cursorNotifier: notifier,
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        {
          "media/v1080/3810.m4s": 98_304,
          "media/v1080/3811.m4s": 98_304,
          "media/v1080/init.mp4": 1024,
        },
        headObjectInputs
      ),
      providerId: "s3_primary",
      response: manifestOptions.response,
      store,
      ...manifestOptions.manifest,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", { pathways, session })
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
          duration: 1,
          kind: "init",
          maxBytes: 2048,
          mediaSequenceNumber: 0,
          objectKey: "media/v1080/init.mp4",
          slotId: "slot_init",
        })
      )
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "media/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );

    const initEvent = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/events",
        s3ObjectCreatedPayload({
          eventTime: "2026-01-01T00:00:01.000Z",
          objectKey: "media/v1080/init.mp4",
          requestId: "commit_init",
          size: 1024,
        })
      )
    );
    const segmentEvent = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/events",
        s3ObjectCreatedPayload({
          eventTime: "2026-01-01T00:00:02.000Z",
          objectKey: "media/v1080/3810.m4s",
          requestId: "commit_3810",
          size: 98_304,
        })
      )
    );
    const segmentEventBody = (await segmentEvent.json()) as {
      results: [{ commit: { slotId: string }; status: string }];
    };
    const media = await handle(
      new Request("https://edge.example.com/v1/live/session_1/v1080/media.m3u8")
    );
    const mediaBody = await media.text();

    expect(initEvent.status).toBe(202);
    expect(segmentEvent.status).toBe(202);
    expect(segmentEventBody.results).toEqual([
      {
        commit: expect.objectContaining({ slotId: "slot_3810" }),
        status: "committed",
      },
    ]);
    expect(media.status).toBe(200);
    expect(mediaBody).toContain(
      "https://media.example.com/media/v1080/3810.m4s"
    );

    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/3811.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3811,
          objectKey: "media/v1080/3811.m4s",
          slotId: "slot_3811",
        })
      )
    );

    const pendingReload = handle(
      new Request(
        "https://edge.example.com/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3811"
      )
    );

    await waitFor(() => waits === 1);

    const nextEvent = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/events",
        s3ObjectCreatedPayload({
          eventTime: "2026-01-01T00:00:03.000Z",
          objectKey: "media/v1080/3811.m4s",
          requestId: "commit_3811",
          size: 98_304,
        })
      )
    );
    const reloaded = await pendingReload;
    const reloadedBody = await reloaded.text();

    expect(nextEvent.status).toBe(202);
    expect(reloaded.status).toBe(200);
    expect(reloadedBody).toContain(
      "https://media.example.com/media/v1080/3811.m4s"
    );
    expect(headObjectInputs).toEqual([
      { Bucket: "media", Key: "media/v1080/init.mp4" },
      { Bucket: "media", Key: "media/v1080/3810.m4s" },
      { Bucket: "media", Key: "media/v1080/3811.m4s" },
    ]);
  });

  test("publishes multiple S3 renditions through coherent HLS manifests", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createS3Client(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        {
          "media/v1080/3810.m4s": 98_304,
          "media/v1080/init.mp4": 1024,
          "media/v720/3810.m4s": 64_000,
          "media/v720/init.mp4": 1024,
        },
        headObjectInputs
      ),
      providerId: "s3_primary",
      response: manifestOptions.response,
      store,
      ...manifestOptions.manifest,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
        session: multiRenditionSession,
      })
    );

    for (const object of [
      renditionObject("v1080", "init"),
      renditionObject("v720", "init"),
      renditionObject("v1080", "segment"),
      renditionObject("v720", "segment"),
    ]) {
      await handle(
        jsonRequest(
          "https://edge.example.com/sessions/session_1/s3/slots",
          slotPayload(object)
        )
      );
      await handle(
        jsonRequest("https://edge.example.com/sessions/session_1/s3/commits", {
          commitId: object.commitId,
          committedAt: object.committedAt,
          independent: object.kind === "segment",
          slotId: object.slotId,
        })
      );
    }

    const master = await handle(
      new Request("https://edge.example.com/v1/live/session_1/master.m3u8")
    );
    const v1080 = await handle(
      new Request("https://edge.example.com/v1/live/session_1/v1080/media.m3u8")
    );
    const v720 = await handle(
      new Request("https://edge.example.com/v1/live/session_1/v720/media.m3u8")
    );
    const masterBody = await master.text();
    const v1080Body = await v1080.text();
    const v720Body = await v720.text();

    expect(master.status).toBe(200);
    expect(masterBody).toContain("/v1/live/session_1/v1080/media.m3u8");
    expect(masterBody).toContain("/v1/live/session_1/v720/media.m3u8");
    expect(v1080.status).toBe(200);
    expect(v1080Body).toContain(
      '#EXT-X-MAP:URI="https://media.example.com/media/v1080/init.mp4"'
    );
    expect(v1080Body).toContain(
      "https://media.example.com/media/v1080/3810.m4s"
    );
    expect(v720.status).toBe(200);
    expect(v720Body).toContain(
      '#EXT-X-MAP:URI="https://media.example.com/media/v720/init.mp4"'
    );
    expect(v720Body).toContain("https://media.example.com/media/v720/3810.m4s");
    expect(headObjectInputs).toEqual([
      { Bucket: "media", Key: "media/v1080/init.mp4" },
      { Bucket: "media", Key: "media/v720/init.mp4" },
      { Bucket: "media", Key: "media/v1080/3810.m4s" },
      { Bucket: "media", Key: "media/v720/3810.m4s" },
    ]);
  });

  test("rejects unsafe S3 slot paths through the Fetch handler", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createS3Client(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      providerId: "s3_primary",
      response: manifestOptions.response,
      store,
      ...manifestOptions.manifest,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", { pathways, session })
    );

    const unsafeKey = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "media/../secret.m4s",
          slotId: "slot_unsafe_key",
        })
      )
    );
    const unsafeUrl = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/3810.m4s?token=1",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "media/v1080/3810.m4s",
          slotId: "slot_unsafe_url",
        })
      )
    );

    expect(unsafeKey.status).toBe(400);
    expect(await unsafeKey.json()).toEqual({
      error: { message: "objectKey must be a safe relative object key" },
    });
    expect(unsafeUrl.status).toBe(400);
    expect(await unsafeUrl.json()).toEqual({
      error: {
        message: "deliveryUrl must not contain query strings or fragments",
      },
    });
  });

  test("rejects wrong-key S3 commits without advancing manifests", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createS3Client(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        {
          "media/v1080/3810.m4s": 98_304,
          "media/v1080/wrong.m4s": 98_304,
        },
        headObjectInputs
      ),
      providerId: "s3_primary",
      response: manifestOptions.response,
      store,
      ...manifestOptions.manifest,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", { pathways, session })
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "media/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );

    const rejected = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/commits", {
        commitId: "commit_wrong",
        committedAt: "2026-01-01T00:00:02.000Z",
        objectKey: "media/v1080/wrong.m4s",
        slotId: "slot_3810",
      })
    );
    const rejectedBody = (await rejected.json()) as {
      error: {
        code: string;
        details: Record<string, unknown>;
      };
    };
    const stored = await store.load(session.sessionId);
    const media = await handle(
      new Request("https://edge.example.com/v1/live/session_1/v1080/media.m3u8")
    );

    expect(rejected.status).toBe(409);
    expect(rejectedBody.error).toMatchObject({
      code: "olos.key_mismatch",
      details: {
        objectKey: "media/v1080/wrong.m4s",
        slotId: "slot_3810",
      },
    });
    expect(stored?.state.commits).toEqual([]);
    expect(stored?.state.cursor).toBeUndefined();
    expect(media.status).toBe(404);
    expect(await media.text()).toBe("manifest not found");
    expect(headObjectInputs).toEqual([]);
  });

  test("rejects oversized S3 commits without advancing manifests", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createS3Client(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        {
          "media/v1080/3810.m4s": 100_001,
        },
        headObjectInputs
      ),
      providerId: "s3_primary",
      response: manifestOptions.response,
      store,
      ...manifestOptions.manifest,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", { pathways, session })
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "media/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );

    const rejected = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/commits", {
        commitId: "commit_3810",
        committedAt: "2026-01-01T00:00:02.000Z",
        slotId: "slot_3810",
      })
    );
    const rejectedBody = (await rejected.json()) as {
      auditEvent: {
        maxBytes: number;
        objectKey: string;
        observedBytes: number;
        reason: string;
        slotId: string;
      };
      error: {
        code: string;
      };
    };
    const stored = await store.load(session.sessionId);
    const media = await handle(
      new Request("https://edge.example.com/v1/live/session_1/v1080/media.m3u8")
    );

    expect(rejected.status).toBe(409);
    expect(rejectedBody.error.code).toBe("olos.object_too_large");
    expect(rejectedBody.auditEvent).toMatchObject({
      maxBytes: 100_000,
      objectKey: "media/v1080/3810.m4s",
      observedBytes: 100_001,
      reason: "object_too_large",
      slotId: "slot_3810",
    });
    expect(stored?.state.commits).toEqual([]);
    expect(stored?.state.cursor).toBeUndefined();
    expect(media.status).toBe(404);
    expect(await media.text()).toBe("manifest not found");
    expect(headObjectInputs).toEqual([
      { Bucket: "media", Key: "media/v1080/3810.m4s" },
    ]);
  });

  test("recovers missed S3 commits through reconciliation routes", async () => {
    const headObjectInputs: unknown[] = [];
    const notifier = createMemoryRuntimeCursorNotifier();
    const store = createMemoryCoordinatorStore();
    let waits = 0;
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      blockingReload: {
        timeoutMs: 1000,
        waitForCursor: (context) => {
          waits += 1;
          return notifier.waitForCursor(context);
        },
      },
      bucket: "media",
      client: createS3Client(),
      cursorNotifier: notifier,
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        {
          "media/v1080/3810.m4s": 98_304,
          "media/v1080/3811.m4s": 98_304,
          "media/v1080/init.mp4": 1024,
        },
        headObjectInputs
      ),
      providerId: "s3_primary",
      response: manifestOptions.response,
      store,
      ...manifestOptions.manifest,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", { pathways, session })
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
          duration: 1,
          kind: "init",
          maxBytes: 2048,
          mediaSequenceNumber: 0,
          objectKey: "media/v1080/init.mp4",
          slotId: "slot_init",
        })
      )
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "media/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );

    const plan = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/reconcile-plan",
        {}
      )
    );
    const planBody = (await plan.json()) as {
      slotIds: string[];
      status: string;
    };
    const recovered = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/reconcile", {
        committedAt: "2026-01-01T00:00:02.000Z",
      })
    );
    const recoveredBody = (await recovered.json()) as {
      results: {
        commit?: { slotId: string };
        cursor?: { window: Record<string, number> };
        slotId: string;
        status: string;
      }[];
      summary: {
        committed: number;
        failed: number;
        ok: boolean;
        planned: number;
        slotIds: string[];
      };
    };
    const media = await handle(
      new Request("https://edge.example.com/v1/live/session_1/v1080/media.m3u8")
    );
    const mediaBody = await media.text();

    expect(plan.status).toBe(200);
    expect(planBody).toEqual({
      slotIds: ["slot_init", "slot_3810"],
      slots: expect.any(Array),
      status: "planned",
    });
    expect(recovered.status).toBe(202);
    expect(recoveredBody.results).toMatchObject([
      {
        commit: { slotId: "slot_init" },
        slotId: "slot_init",
        status: "committed",
      },
      {
        commit: { slotId: "slot_3810" },
        cursor: {
          window: {
            firstMediaSequenceNumber: 3810,
            lastMediaSequenceNumber: 3810,
          },
        },
        slotId: "slot_3810",
        status: "committed",
      },
    ]);
    expect(recoveredBody.summary).toEqual({
      committed: 2,
      failed: 0,
      failedErrorCodes: [],
      failedSlotIds: [],
      idempotent: 0,
      ok: true,
      planned: 2,
      slotIds: ["slot_init", "slot_3810"],
      status: "reconciled",
    });
    expect(media.status).toBe(200);
    expect(mediaBody).toContain(
      "https://media.example.com/media/v1080/3810.m4s"
    );

    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/3811.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3811,
          objectKey: "media/v1080/3811.m4s",
          slotId: "slot_3811",
        })
      )
    );

    const nextPlan = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/reconcile-plan",
        {
          slotIds: ["slot_3811"],
        }
      )
    );
    const pendingReload = handle(
      new Request(
        "https://edge.example.com/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3811"
      )
    );

    await waitFor(() => waits === 1);

    const nextRecovered = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/reconcile", {
        committedAt: "2026-01-01T00:00:03.000Z",
        slotIds: ["slot_3811"],
      })
    );
    const nextRecoveredBody = (await nextRecovered.json()) as {
      summary: {
        committed: number;
        ok: boolean;
        planned: number;
        slotIds: string[];
      };
    };
    const reloaded = await pendingReload;
    const reloadedBody = await reloaded.text();

    expect(nextPlan.status).toBe(200);
    expect(await nextPlan.json()).toMatchObject({
      slotIds: ["slot_3811"],
      status: "planned",
    });
    expect(nextRecovered.status).toBe(202);
    expect(nextRecoveredBody.summary).toMatchObject({
      committed: 1,
      ok: true,
      planned: 1,
      slotIds: ["slot_3811"],
    });
    expect(reloaded.status).toBe(200);
    expect(reloadedBody).toContain(
      "https://media.example.com/media/v1080/3811.m4s"
    );
    expect(headObjectInputs).toEqual([
      { Bucket: "media", Key: "media/v1080/init.mp4" },
      { Bucket: "media", Key: "media/v1080/3810.m4s" },
      { Bucket: "media", Key: "media/v1080/3811.m4s" },
    ]);
  });

  test("deletes retired S3 objects through the retention route", async () => {
    const { deleteInputs, handle } = createRetentionPipeline();

    await handle(
      jsonRequest("https://edge.example.com/sessions", { pathways, session })
    );

    for (const object of retentionObjects()) {
      await handle(
        jsonRequest(
          "https://edge.example.com/sessions/session_1/s3/slots",
          slotPayload(object)
        )
      );
      await handle(
        jsonRequest("https://edge.example.com/sessions/session_1/s3/commits", {
          commitId: object.commitId,
          committedAt: "2026-01-01T00:00:02.000Z",
          independent: object.kind === "segment",
          ...(object.maxSegments === undefined
            ? {}
            : { maxSegments: object.maxSegments }),
          slotId: object.slotId,
        })
      );
    }

    const retention = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/retention", {
        now: "2026-01-01T00:00:06.000Z",
      })
    );
    const retentionBody = (await retention.json()) as {
      plan: {
        retiredObjects: {
          commitId: string;
          objectKey: string;
          slotId: string;
        }[];
      };
      result: {
        deletedObjects: {
          commitId: string;
          objectKey: string;
          slotId: string;
        }[];
        failedObjects: unknown[];
      };
    };
    const media = await handle(
      new Request("https://edge.example.com/v1/live/session_1/v1080/media.m3u8")
    );
    const mediaBody = await media.text();

    expect(retention.status).toBe(202);
    expect(retentionBody.plan.retiredObjects).toEqual([
      {
        commitId: "commit_3810",
        objectKey: "media/v1080/3810.m4s",
        slotId: "slot_3810",
      },
    ]);
    expect(retentionBody.result).toEqual({
      deletedObjects: retentionBody.plan.retiredObjects,
      failedObjects: [],
    });
    expect(deleteInputs).toEqual([
      { Bucket: "media", Key: "media/v1080/3810.m4s" },
    ]);
    expect(media.status).toBe(200);
    expect(mediaBody).not.toContain("media/v1080/3810.m4s");
    expect(mediaBody).toContain("media/v1080/3811.m4s");
    expect(mediaBody).toContain("media/v1080/3812.m4s");
  });

  test("reports failed S3 retention deletes without changing the cursor", async () => {
    const { deleteInputs, handle, store } = createRetentionPipeline({
      failingDeleteKey: "media/v1080/3810.m4s",
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", { pathways, session })
    );

    for (const object of retentionObjects()) {
      await handle(
        jsonRequest(
          "https://edge.example.com/sessions/session_1/s3/slots",
          slotPayload(object)
        )
      );
      await handle(
        jsonRequest("https://edge.example.com/sessions/session_1/s3/commits", {
          commitId: object.commitId,
          committedAt: "2026-01-01T00:00:02.000Z",
          independent: object.kind === "segment",
          ...(object.maxSegments === undefined
            ? {}
            : { maxSegments: object.maxSegments }),
          slotId: object.slotId,
        })
      );
    }

    const before = await store.load(session.sessionId);
    const retention = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/retention", {
        now: "2026-01-01T00:00:06.000Z",
      })
    );
    const retentionBody = (await retention.json()) as {
      result: {
        deletedObjects: unknown[];
        failedObjects: {
          error: string;
          object: {
            commitId: string;
            objectKey: string;
            slotId: string;
          };
        }[];
      };
      summary: {
        deleted: number;
        failed: number;
        failedObjectKeys: string[];
        failedSlotIds: string[];
        ok: boolean;
        planned: number;
      };
    };
    const after = await store.load(session.sessionId);

    expect(retention.status).toBe(202);
    expect(deleteInputs).toEqual([
      { Bucket: "media", Key: "media/v1080/3810.m4s" },
    ]);
    expect(retentionBody.result).toEqual({
      deletedObjects: [],
      failedObjects: [
        {
          error: "delete failed",
          object: {
            commitId: "commit_3810",
            objectKey: "media/v1080/3810.m4s",
            slotId: "slot_3810",
          },
        },
      ],
    });
    expect(retentionBody.summary).toEqual({
      deleted: 0,
      failed: 1,
      failedObjectKeys: ["media/v1080/3810.m4s"],
      failedSlotIds: ["slot_3810"],
      ok: false,
      planned: 1,
    });
    expect(after?.state.cursor).toEqual(before?.state.cursor);
  });
});

interface SlotPayloadOptions {
  deliveryUrl: string;
  duration: number;
  kind: "init" | "segment";
  maxBytes: number;
  maxSegments?: number;
  mediaSequenceNumber: number;
  objectKey: string;
  renditionId?: string;
  slotId: string;
}

function renditionObject(
  renditionId: "v1080" | "v720",
  kind: "init" | "segment"
): SlotPayloadOptions & { commitId: string; committedAt: string } {
  const name = kind === "init" ? "init.mp4" : "3810.m4s";
  const objectKey = `media/${renditionId}/${name}`;
  const slotSuffix = kind === "init" ? "init" : "3810";

  return {
    commitId: `commit_${renditionId}_${slotSuffix}`,
    committedAt:
      kind === "init" ? "2026-01-01T00:00:01.000Z" : "2026-01-01T00:00:02.000Z",
    deliveryUrl: `https://media.example.com/${objectKey}`,
    duration: kind === "init" ? 1 : 2,
    kind,
    maxBytes: kind === "init" ? 2048 : 100_000,
    mediaSequenceNumber: kind === "init" ? 0 : 3810,
    objectKey,
    renditionId,
    slotId: `slot_${renditionId}_${slotSuffix}`,
  };
}

function slotPayload(options: SlotPayloadOptions) {
  return {
    contentType: "video/mp4",
    deliveryUrl: options.deliveryUrl,
    duration: options.duration,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: options.kind,
    maxBytes: options.maxBytes,
    mediaSequenceNumber: options.mediaSequenceNumber,
    objectKey: options.objectKey,
    publicationMode: "direct-public" as const,
    publisherInstanceId: "publisher_1",
    renditionId: options.renditionId ?? "v1080",
    slotId: options.slotId,
  };
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}

interface S3ObjectCreatedPayloadOptions {
  eventTime: string;
  objectKey: string;
  requestId: string;
  size: number;
}

function s3ObjectCreatedPayload(options: S3ObjectCreatedPayloadOptions) {
  return {
    Records: [
      {
        eventName: "ObjectCreated:Put",
        eventTime: options.eventTime,
        responseElements: {
          "x-amz-request-id": options.requestId,
        },
        s3: {
          bucket: {
            name: "media",
          },
          object: {
            eTag: options.requestId,
            key: options.objectKey,
            size: options.size,
          },
        },
      },
    ],
  };
}

function retentionObjects(): (SlotPayloadOptions & { commitId: string })[] {
  return [
    {
      commitId: "commit_init",
      deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
      duration: 1,
      kind: "init",
      maxBytes: 2048,
      mediaSequenceNumber: 0,
      objectKey: "media/v1080/init.mp4",
      slotId: "slot_init",
    },
    {
      commitId: "commit_3810",
      deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
      duration: 2,
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKey: "media/v1080/3810.m4s",
      slotId: "slot_3810",
    },
    {
      commitId: "commit_3811",
      deliveryUrl: "https://media.example.com/media/v1080/3811.m4s",
      duration: 2,
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3811,
      objectKey: "media/v1080/3811.m4s",
      slotId: "slot_3811",
    },
    {
      commitId: "commit_3812",
      deliveryUrl: "https://media.example.com/media/v1080/3812.m4s",
      duration: 2,
      kind: "segment",
      maxBytes: 100_000,
      maxSegments: 2,
      mediaSequenceNumber: 3812,
      objectKey: "media/v1080/3812.m4s",
      slotId: "slot_3812",
    },
  ];
}

function createRetentionPipeline(options: { failingDeleteKey?: string } = {}) {
  const deleteInputs: unknown[] = [];
  const headObjectInputs: unknown[] = [];
  const store = createMemoryCoordinatorStore();
  const handle = createStoredS3CoordinatorRuntimeHandler({
    allowedMediaOrigins: ["https://media.example.com"],
    bucket: "media",
    client: createS3Client(),
    expiresInSeconds: 3,
    grantNow: () => "2026-01-01T00:00:00.000Z",
    objectClient: objectClientFor(
      {
        "media/v1080/3810.m4s": 98_304,
        "media/v1080/3811.m4s": 98_304,
        "media/v1080/3812.m4s": 98_304,
        "media/v1080/init.mp4": 1024,
      },
      headObjectInputs
    ),
    providerId: "s3_primary",
    response: manifestOptions.response,
    retentionClient: deleteClientFor(deleteInputs, options.failingDeleteKey),
    store,
    ...manifestOptions.manifest,
  });

  return { deleteInputs, handle, store };
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

function deleteClientFor(
  inputs: unknown[],
  failingKey?: string
): S3DeleteObjectClient {
  return {
    send(command: DeleteObjectCommand): Promise<DeleteObjectCommandOutput> {
      inputs.push(command.input);

      if (command.input.Key === failingKey) {
        throw new Error("delete failed");
      }

      return Promise.resolve({ $metadata: {} });
    },
  };
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

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > 1000) {
      throw new Error("condition was not met before timeout");
    }

    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
