import { createRuntimeObjectLowLatencyProfile } from "@arsenstorm/olos/media";
import { createMemoryCoordinatorStore } from "@arsenstorm/olos/protocol";
import {
  commitRuntimeUpload,
  createMemoryRuntimeCursorNotifier,
  createRuntimeSession,
  createStoredCoordinatorRuntimeHandler,
  getRuntimeMasterPlaylist,
  getRuntimeMediaPlaylist,
  getRuntimeSessionHealth,
  getRuntimeSessionRetentionPlan,
  issueRuntimeSlot,
  type RuntimeFetch,
  RuntimeHttpError,
  sendRuntimePublisherHeartbeat,
} from "@arsenstorm/olos/runtime";
import { describe, expect, test } from "vitest";
import { createTestSession, TEST_MEDIA_BASE_URL } from "./protocol-fixtures";
import { waitFor } from "./wait-for";

const latency = createRuntimeObjectLowLatencyProfile();
const session = createTestSession({ state: "live" });
const deliveryBaseUrl = TEST_MEDIA_BASE_URL;

describe("runtime public client flow", () => {
  test("publishes committed objects and reads generated playlists", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedDeliveryOrigins: ["https://media.example.com"],
      now: () => "2026-01-01T00:00:03.000Z",
      publicationMode: "read-gated",
      store,
    });
    const fetch = runtimeFetchFor(handle);

    const created = await createRuntimeSession({
      baseUrl: "https://edge.example.com",
      deliveryBaseUrl,
      fetch,
      session,
    });

    const init = await issueRuntimeSlot({
      baseUrl: "https://edge.example.com",
      fetch,
      payload: {
        contentType: "video/mp4",
        expiresAt: "2026-01-01T00:00:05.000Z",
        extension: "mp4",
        kind: "init",
        maxBytes: 2048,
        objectKeyPrefix: "media",
        profile: { duration: 1 },
        sequenceNumber: 0,
        slotId: "slot_init",
        trackId: "v1080",
      },
      sessionId: session.sessionId,
    });
    const segment = await issueRuntimeSlot({
      baseUrl: "https://edge.example.com",
      fetch,
      payload: {
        contentType: "video/mp4",
        expiresAt: "2026-01-01T00:00:05.000Z",
        extension: "m4s",
        kind: "segment",
        maxBytes: 100_000,
        objectKeyPrefix: "media",
        profile: { duration: latency.segmentTarget },
        sequenceNumber: 3810,
        slotId: "slot_3810",
        trackId: "v1080",
      },
      sessionId: session.sessionId,
    });

    const initCommit = await commitRuntimeUpload({
      baseUrl: "https://edge.example.com",
      fetch,
      payload: {
        commitId: "commit_init",
        committedAt: "2026-01-01T00:00:01.000Z",
        object: {
          contentType: "video/mp4",
          objectKey: init.slot.objectKey,
          observedAt: "2026-01-01T00:00:01.000Z",
          providerId: "s3_primary",
          size: 1024,
        },
        slotId: init.slot.slotId,
      },
      sessionId: session.sessionId,
    });
    const segmentCommit = await commitRuntimeUpload({
      baseUrl: "https://edge.example.com",
      fetch,
      payload: {
        commitId: "commit_3810",
        committedAt: "2026-01-01T00:00:02.000Z",
        object: {
          contentType: "video/mp4",
          objectKey: segment.slot.objectKey,
          observedAt: "2026-01-01T00:00:02.000Z",
          providerId: "s3_primary",
          size: 98_304,
        },
        profile: { independent: true },
        slotId: segment.slot.slotId,
      },
      sessionId: session.sessionId,
    });
    const master = await getRuntimeMasterPlaylist({
      baseUrl: "https://edge.example.com",
      fetch,
      sessionId: session.sessionId,
    });
    const media = await getRuntimeMediaPlaylist({
      baseUrl: "https://edge.example.com",
      fetch,
      sessionId: session.sessionId,
      trackId: "v1080",
    });
    const health = await getRuntimeSessionHealth({
      baseUrl: "https://edge.example.com",
      fetch,
      sessionId: session.sessionId,
    });
    const retention = await getRuntimeSessionRetentionPlan({
      baseUrl: "https://edge.example.com",
      fetch,
      now: "2026-01-01T00:00:03.000Z",
      sessionId: session.sessionId,
    });

    expect(created.sessionId).toBe(session.sessionId);
    expect(initCommit.commit.slotId).toBe("slot_init");
    expect(segmentCommit.cursor?.window).toEqual({
      firstSequenceNumber: 3810,
      lastSequenceNumber: 3810,
    });
    expect(master.playlist).toContain("/v1/live/session_1/v1080/media.m3u8");
    expect(media.playlist).toContain("#EXT-X-MEDIA-SEQUENCE:3810");
    expect(media.playlist).toContain(
      '#EXT-X-MAP:URI="https://media.example.com/media/v1080/init.mp4"'
    );
    expect(media.playlist).toContain(
      "https://media.example.com/media/v1080/s3810.m4s"
    );
    expect(health.health.status).toBe("active");
    expect(retention.plan.retiredObjects).toEqual([]);
  });

  test("reports stale publisher leases through stored health", async () => {
    let now = "2026-01-01T00:00:00.000Z";
    const store = createMemoryCoordinatorStore();
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedDeliveryOrigins: ["https://media.example.com"],
      maxHealthCursorAgeMs: 10_000,
      now: () => now,
      publicationMode: "read-gated",
      publisherLeaseTtlMs: 3000,
      store,
    });
    const fetch = runtimeFetchFor(handle);

    await createRuntimeSession({
      baseUrl: "https://edge.example.com",
      deliveryBaseUrl,
      fetch,
      session,
    });
    await publishObject(fetch, {
      commitId: "commit_init",
      duration: 1,
      kind: "init",
      maxBytes: 2048,
      objectKey: "media/v1080/init.mp4",
      sequenceNumber: 0,
      size: 1024,
      slotId: "slot_init",
    });
    await publishObject(fetch, {
      commitId: "commit_3810",
      independent: true,
      objectKey: "media/v1080/s3810.m4s",
      sequenceNumber: 3810,
      size: 98_304,
      slotId: "slot_3810",
    });

    now = "2026-01-01T00:00:02.000Z";
    const heartbeat = await sendRuntimePublisherHeartbeat({
      baseUrl: "https://edge.example.com",
      fetch,
      publisherInstanceId: "publisher_1",
      sessionId: session.sessionId,
    });
    const active = await getRuntimeSessionHealth({
      baseUrl: "https://edge.example.com",
      fetch,
      publisherInstanceId: "publisher_1",
      sessionId: session.sessionId,
    });

    now = "2026-01-01T00:00:05.001Z";
    const stale = await getRuntimeSessionHealth({
      baseUrl: "https://edge.example.com",
      fetch,
      publisherInstanceId: "publisher_1",
      sessionId: session.sessionId,
    });

    expect(heartbeat.lease).toMatchObject({
      expiresAt: "2026-01-01T00:00:05.000Z",
      lastSeenAt: "2026-01-01T00:00:02.000Z",
      publisherInstanceId: "publisher_1",
    });
    expect(active.health).toMatchObject({
      cursorAgeMs: 0,
      cursorFreshness: "fresh",
      leaseStatus: "active",
      publisherInstanceId: "publisher_1",
      status: "active",
    });
    expect(stale.health).toMatchObject({
      cursorAgeMs: 3001,
      cursorFreshness: "fresh",
      leaseStatus: "stale",
      publisherInstanceId: "publisher_1",
      status: "stale",
    });
  });

  test("blocks public playlist reloads until the requested cursor is committed", async () => {
    const notifier = createMemoryRuntimeCursorNotifier();
    const store = createMemoryCoordinatorStore();
    let waits = 0;
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedDeliveryOrigins: ["https://media.example.com"],
      blockingReload: {
        timeoutMs: 1000,
        waitForCursor: (context) => {
          waits += 1;
          return notifier.waitForCursor(context);
        },
      },
      cursorNotifier: notifier,
      publicationMode: "read-gated",
      store,
    });
    const fetch = runtimeFetchFor(handle);

    await createRuntimeSession({
      baseUrl: "https://edge.example.com",
      deliveryBaseUrl,
      fetch,
      session,
    });
    await publishObject(fetch, {
      commitId: "commit_init",
      duration: 1,
      kind: "init",
      maxBytes: 2048,
      objectKey: "media/v1080/init.mp4",
      sequenceNumber: 0,
      size: 1024,
      slotId: "slot_init",
    });
    await publishObject(fetch, {
      commitId: "commit_3810",
      independent: true,
      objectKey: "media/v1080/s3810.m4s",
      sequenceNumber: 3810,
      size: 98_304,
      slotId: "slot_3810",
    });

    const pendingReload = getRuntimeMediaPlaylist({
      baseUrl: "https://edge.example.com",
      fetch,
      hlsMsn: 3811,
      sessionId: session.sessionId,
      trackId: "v1080",
    });

    await waitFor(() => waits === 1, { attempts: 20, intervalMs: 0 });

    await publishObject(fetch, {
      commitId: "commit_3811",
      objectKey: "media/v1080/s3811.m4s",
      sequenceNumber: 3811,
      size: 98_304,
      slotId: "slot_3811",
    });

    const reloaded = await pendingReload;

    expect(reloaded.playlist).toContain("#EXT-X-MEDIA-SEQUENCE:3810");
    expect(reloaded.playlist).toContain(
      "https://media.example.com/media/v1080/s3811.m4s"
    );
  });

  test("returns structured errors for failed public client requests", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedDeliveryOrigins: ["https://media.example.com"],
      publicationMode: "read-gated",
      store,
    });
    const fetch = runtimeFetchFor(handle);

    const error = await getRuntimeSessionHealth({
      baseUrl: "https://edge.example.com",
      fetch,
      sessionId: "missing_session",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RuntimeHttpError);
    expect(error).toMatchObject({
      body: {
        error: {
          code: "olos.invalid_session",
          message: "coordinator session was not found",
        },
      },
      message: "session health failed with status 404",
      status: 404,
    });
    expect((error as RuntimeHttpError).response.status).toBe(404);
  });
});

interface PublishObjectOptions {
  commitId: string;
  duration?: number;
  independent?: boolean;
  kind?: "init" | "segment";
  maxBytes?: number;
  objectKey: string;
  sequenceNumber: number;
  size: number;
  slotId: string;
}

async function publishObject(
  fetch: RuntimeFetch,
  options: PublishObjectOptions
) {
  const kind = options.kind ?? "segment";

  const slot = await issueRuntimeSlot({
    baseUrl: "https://edge.example.com",
    fetch,
    payload: {
      contentType: "video/mp4",
      expiresAt: "2026-01-01T00:00:05.000Z",
      extension: kind === "init" ? "mp4" : "m4s",
      kind,
      maxBytes: options.maxBytes ?? 100_000,
      objectKeyPrefix: "media",
      profile: { duration: options.duration ?? latency.segmentTarget },
      sequenceNumber: options.sequenceNumber,
      slotId: options.slotId,
      trackId: "v1080",
    },
    sessionId: session.sessionId,
  });

  return await commitRuntimeUpload({
    baseUrl: "https://edge.example.com",
    fetch,
    payload: {
      commitId: options.commitId,
      committedAt: "2026-01-01T00:00:02.000Z",
      ...(options.independent === undefined
        ? {}
        : { profile: { independent: options.independent } }),
      object: {
        contentType: "video/mp4",
        objectKey: slot.slot.objectKey,
        observedAt: "2026-01-01T00:00:02.000Z",
        providerId: "s3_primary",
        size: options.size,
      },
      slotId: slot.slot.slotId,
    },
    sessionId: session.sessionId,
  });
}

function runtimeFetchFor(
  handle: (request: Request) => Promise<Response>
): RuntimeFetch {
  return (request, init) =>
    handle(
      request instanceof Request ? request : new Request(String(request), init)
    );
}
