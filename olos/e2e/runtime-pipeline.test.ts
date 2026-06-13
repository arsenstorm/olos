import {
  type CoordinatorPipelineStore,
  createMemoryCoordinatorStore,
  createSerializedCoordinatorStore,
  createSqliteSerializedCoordinatorStoreBackend,
  type SqliteSerializedCoordinatorStoreDatabase,
  type SqliteSerializedCoordinatorStoreRunResult,
} from "olos/protocol";
import {
  commitStoredCoordinatorUploadFromRequest,
  createRuntimeObjectLowLatencyManifestOptions,
  createRuntimeObjectLowLatencyProfile,
  createRuntimeObjectLowLatencyPublisherDefaults,
  createRuntimeObjectLowLatencyPublisherOptions,
  createRuntimePublisherNextObjectPlan,
  createRuntimePublisherObjectKeyNonce,
  createRuntimePublisherObjectPlan,
  createStoredCoordinatorSession,
  issueStoredCoordinatorSlotFromRequest,
  planStoredCoordinatorRetention,
  resolveRuntimePublisherObjectExpiry,
  serveStoredCoordinatorManifest,
  transitionStoredCoordinatorSession,
} from "olos/runtime";
import type { Pathway, Session } from "olos/types";
import { assertCursor } from "olos/validation";
import { describe, expect, test } from "vitest";

const latency = createRuntimeObjectLowLatencyProfile();
const manifestOptions = createRuntimeObjectLowLatencyManifestOptions(latency);
const publisherOptions = createRuntimeObjectLowLatencyPublisherOptions(latency);

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

describe("runtime pipeline", () => {
  test("runs stored coordinator lifecycle through public runtime exports", async () => {
    await expect(
      expectStoredCoordinatorLifecycle(createMemoryCoordinatorStore())
    ).resolves.toBeUndefined();
  });

  test("runs stored coordinator lifecycle through a SQLite serialized store", async () => {
    const store = createSerializedCoordinatorStore(
      createSqliteSerializedCoordinatorStoreBackend({
        database: createSqliteDatabase(),
      })
    );

    await expect(
      expectStoredCoordinatorLifecycle(store)
    ).resolves.toBeUndefined();
  });

  test("applies the object low-latency profile across publish and manifest flow", async () => {
    const store = createMemoryCoordinatorStore();
    const defaults = createRuntimeObjectLowLatencyPublisherDefaults({
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
    const initNonce = createRuntimePublisherObjectKeyNonce({
      bytes: nonceBytes(1),
    });
    const segmentNonce = createRuntimePublisherObjectKeyNonce({
      bytes: nonceBytes(2),
    });
    const init = createRuntimePublisherNextObjectPlan({
      baseUrl: "https://media.example.com",
      defaults,
      initPublished: false,
      minTtlSeconds: publisherOptions.expiry.minTtlSeconds,
      now: publishNow,
      objectKeyNonce: initNonce,
      objectKeyPrefix: "media",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      targetLatency: publisherOptions.expiry.targetLatency,
    });
    const next = createRuntimePublisherNextObjectPlan({
      baseUrl: "https://media.example.com",
      defaults,
      initPublished: true,
      minTtlSeconds: publisherOptions.expiry.minTtlSeconds,
      now: publishNow,
      objectKeyNonce: segmentNonce,
      objectKeyPrefix: "media",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      startMediaSequenceNumber: 3810,
      targetLatency: publisherOptions.expiry.targetLatency,
    });

    await createStoredCoordinatorSession({
      pathways,
      session,
      store,
    });

    const initIssue = await issueStoredCoordinatorSlotFromRequest({
      request: init.plan.slot,
      sessionId: session.sessionId,
      store,
    });
    const issued = await issueStoredCoordinatorSlotFromRequest({
      request: next.plan.slot,
      sessionId: session.sessionId,
      store,
    });
    const initCommit = await commitStoredCoordinatorUploadFromRequest({
      request: commitPayload({
        commitId: init.plan.commitId,
        objectKey: init.plan.slot.objectKey,
        size: 1024,
        slotId: init.plan.slot.slotId,
      }),
      sessionId: session.sessionId,
      store,
    });
    const committed = await commitStoredCoordinatorUploadFromRequest({
      request: {
        ...commitPayload({
          commitId: next.plan.commitId,
          objectKey: next.plan.slot.objectKey,
          size: 98_304,
          slotId: next.plan.slot.slotId,
        }),
        independent: true,
      },
      sessionId: session.sessionId,
      store,
    });
    const media = await serveStoredCoordinatorManifest({
      allowedMediaOrigins: ["https://media.example.com"],
      ...manifestOptions.manifest,
      request: "https://edge.example.com/v1/live/session_1/v1080/media.m3u8",
      response: manifestOptions.response,
      sessionId: session.sessionId,
      store,
    });
    const body = await media.text();

    expect(init.position).toEqual({
      kind: "init",
      mediaSequenceNumber: 0,
    });
    expect(init.plan.slot.objectKey).toBe(
      "media/v1080/init-slot_01010101010101010101010101010101.mp4"
    );
    expect(next.position).toEqual({
      kind: "segment",
      mediaSequenceNumber: 3810,
    });
    expect(next.plan.slot.objectKey).toBe(
      "media/v1080/s3810/segment-slot_02020202020202020202020202020202.m4s"
    );
    expect(next.expiry).toEqual({
      expiresAt: "2026-01-01T00:00:05.000Z",
      ttlSeconds: 5,
    });
    expect(next.plan.slot).toMatchObject({
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      mediaSequenceNumber: 3810,
    });
    expect(initIssue.status).toBe("issued");
    expect(issued.status).toBe("issued");
    expect(initCommit.status).toBe("committed");
    expect(committed.status).toBe("committed");
    expect(
      committed.status === "committed" ? committed.state.cursor?.window : {}
    ).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(media.status).toBe(200);
    expect(media.headers.get("cache-control")).toBe(
      "public, max-age=1, must-revalidate"
    );
    expect(body).toContain("#EXT-X-TARGETDURATION:2");
    expect(body).toContain("#EXT-X-PART-INF:PART-TARGET=0.5");
    expect(body).toContain("#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES");
    expect(body).toContain(next.plan.slot.deliveryUrl);
  });
});

async function expectStoredCoordinatorLifecycle(
  store: CoordinatorPipelineStore
) {
  const created = await createStoredCoordinatorSession({
    pathways,
    session,
    store,
  });

  ensureEqual(created.status, "created", "session should be created");

  const initPlan = createRuntimePublisherObjectPlan({
    baseUrl: "https://media.example.com",
    contentType: "video/mp4",
    duration: 1,
    expiresAt: plannedExpiry(1).expiresAt,
    extension: "mp4",
    kind: "init",
    maxBytes: 2048,
    mediaSequenceNumber: 0,
    objectKeyNonce: "slot_init",
    objectKeyPrefix: "media",
    publicationMode: "direct-public",
    publisherInstanceId: "pub_1",
    renditionId: "v1080",
  });
  const segmentPlan = createRuntimePublisherObjectPlan({
    baseUrl: "https://media.example.com",
    contentType: "video/mp4",
    duration: 2,
    expiresAt: plannedExpiry(2).expiresAt,
    extension: "m4s",
    kind: "segment",
    maxBytes: 100_000,
    mediaSequenceNumber: 3810,
    objectKeyNonce: "slot_s3810",
    objectKeyPrefix: "media",
    publicationMode: "direct-public",
    publisherInstanceId: "pub_1",
    renditionId: "v1080",
  });
  const nextPlan = createRuntimePublisherObjectPlan({
    baseUrl: "https://media.example.com",
    contentType: "video/mp4",
    duration: 2,
    expiresAt: plannedExpiry(2).expiresAt,
    extension: "m4s",
    kind: "segment",
    maxBytes: 100_000,
    mediaSequenceNumber: 3811,
    objectKeyNonce: "slot_s3811",
    objectKeyPrefix: "media",
    publicationMode: "direct-public",
    publisherInstanceId: "pub_1",
    renditionId: "v1080",
  });

  const initIssue = await issueStoredCoordinatorSlotFromRequest({
    request: initPlan.slot,
    sessionId: session.sessionId,
    store,
  });
  const segmentIssue = await issueStoredCoordinatorSlotFromRequest({
    request: segmentPlan.slot,
    sessionId: session.sessionId,
    store,
  });
  const nextIssue = await issueStoredCoordinatorSlotFromRequest({
    request: nextPlan.slot,
    sessionId: session.sessionId,
    store,
  });

  ensureEqual(initIssue.status, "issued", "init slot should be issued");
  ensureEqual(segmentIssue.status, "issued", "segment slot should be issued");
  ensureEqual(nextIssue.status, "issued", "next slot should be issued");

  const initCommit = await commitStoredCoordinatorUploadFromRequest({
    request: commitPayload({
      commitId: initPlan.commitId,
      objectKey: initPlan.slot.objectKey,
      size: 1024,
      slotId: initPlan.slot.slotId,
    }),
    sessionId: session.sessionId,
    store,
  });
  const segmentCommit = await commitStoredCoordinatorUploadFromRequest({
    request: {
      ...commitPayload({
        commitId: segmentPlan.commitId,
        objectKey: segmentPlan.slot.objectKey,
        size: 98_304,
        slotId: segmentPlan.slot.slotId,
      }),
      independent: true,
    },
    sessionId: session.sessionId,
    store,
  });

  ensureEqual(initCommit.status, "committed", "init should commit");
  ensureEqual(segmentCommit.status, "committed", "segment should commit");

  const snapshot = await store.load(session.sessionId);
  const cursor = snapshot?.state.cursor;

  if (snapshot === undefined || cursor === undefined) {
    throw new Error("expected stored cursor");
  }

  assertCursor(cursor);

  const master = await serveStoredCoordinatorManifest({
    allowedMediaOrigins: ["https://media.example.com"],
    ...manifestOptions.manifest,
    request: "https://edge.example.com/v1/live/session_1/master.m3u8",
    sessionId: session.sessionId,
    store,
  });
  const media = await serveStoredCoordinatorManifest({
    allowedMediaOrigins: ["https://media.example.com"],
    ...manifestOptions.manifest,
    request: "https://edge.example.com/v1/live/session_1/v1080/media.m3u8",
    sessionId: session.sessionId,
    store,
  });

  ensureEqual(
    cursor.window,
    {
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    },
    "cursor should advance to committed segment"
  );
  ensureEqual(master.status, 200, "master manifest should be served");
  ensureIncludes(
    await master.text(),
    "/v1/live/session_1/v1080/media.m3u8",
    "master manifest should link media playlist"
  );
  ensureEqual(media.status, 200, "media manifest should be served");
  ensureIncludes(
    await media.text(),
    segmentPlan.slot.deliveryUrl,
    "media manifest should include segment"
  );

  const transitioned = await transitionStoredCoordinatorSession({
    sessionId: session.sessionId,
    state: "ending",
    store,
  });

  ensureEqual(transitioned.status, "transitioned", "session should transition");

  if (transitioned.status !== "transitioned") {
    throw new Error("expected session transition");
  }

  ensureEqual(
    transitioned.state.session.state,
    "ending",
    "session state should end"
  );
  ensureEqual(
    transitioned.state.cursor?.state,
    "ending",
    "cursor state should end"
  );

  const retention = await planStoredCoordinatorRetention({
    now: "2026-01-01T00:00:06.000Z",
    sessionId: session.sessionId,
    store,
  });

  ensureEqual(retention.status, "planned", "retention should plan");

  if (retention.status !== "planned") {
    throw new Error("expected retention plan");
  }

  ensureEqual(
    retention.plan.expiredSlots.map((slot) => slot.slotId),
    [nextPlan.slot.slotId],
    "retention should expire uncommitted next slot"
  );
  ensureEqual(
    retention.plan.retiredObjects,
    [],
    "retention should not retire committed window objects"
  );
}

function plannedExpiry(duration: number) {
  return resolveRuntimePublisherObjectExpiry({
    duration,
    minTtlSeconds: publisherOptions.expiry.minTtlSeconds,
    now: publishNow,
    targetLatency: publisherOptions.expiry.targetLatency,
  });
}

function nonceBytes(value: number): Uint8Array {
  return new Uint8Array(16).fill(value);
}

interface CommitPayloadOptions {
  commitId: string;
  objectKey: string;
  size: number;
  slotId: string;
}

function commitPayload(options: CommitPayloadOptions) {
  return {
    commitId: options.commitId,
    committedAt: "2026-01-01T00:00:02.000Z",
    object: {
      contentType: "video/mp4",
      objectKey: options.objectKey,
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      size: options.size,
    },
    slotId: options.slotId,
  };
}

function createSqliteDatabase(): SqliteSerializedCoordinatorStoreDatabase {
  const records = new Map<string, { etag: string; snapshot: string }>();

  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            first<T>() {
              return Promise.resolve(select<T>(records, sql, values));
            },
            run() {
              return Promise.resolve(run(records, sql, values));
            },
          };
        },
      };
    },
  };
}

function select<T>(
  records: Map<string, { etag: string; snapshot: string }>,
  sql: string,
  values: readonly unknown[]
): T | undefined {
  if (!sql.startsWith("select")) {
    throw new Error(`unexpected select SQL: ${sql}`);
  }

  return records.get(String(values[0])) as T | undefined;
}

function run(
  records: Map<string, { etag: string; snapshot: string }>,
  sql: string,
  values: readonly unknown[]
): SqliteSerializedCoordinatorStoreRunResult {
  if (sql.startsWith("insert")) {
    const sessionId = String(values[0]);

    if (records.has(sessionId)) {
      return { meta: { changes: 0 } };
    }

    records.set(sessionId, {
      etag: String(values[1]),
      snapshot: String(values[2]),
    });

    return { meta: { changes: 1 } };
  }

  if (!sql.startsWith("update")) {
    throw new Error(`unexpected update SQL: ${sql}`);
  }

  const sessionId = String(values[2]);
  const expectedEtag = String(values[3]);
  const current = records.get(sessionId);

  if (current?.etag !== expectedEtag) {
    return { meta: { changes: 0 } };
  }

  records.set(sessionId, {
    etag: String(values[0]),
    snapshot: String(values[1]),
  });

  return { meta: { changes: 1 } };
}

function ensureEqual(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}`);
  }
}

function ensureIncludes(value: string, expected: string, message: string) {
  if (!value.includes(expected)) {
    throw new Error(`${message}: expected ${expected}`);
  }
}
