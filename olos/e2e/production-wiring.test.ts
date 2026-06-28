import { createMemoryCoordinatorStore } from "@arsenstorm/olos/protocol";
import {
  createMemoryRuntimeCursorNotifier,
  createRuntimeObjectLowLatencyManifestOptions,
  createRuntimeObjectLowLatencyProfile,
} from "@arsenstorm/olos/runtime";
import { createStoredS3CoordinatorRuntimeHandler } from "@arsenstorm/olos/s3";
import type { Session } from "@arsenstorm/olos/types";
import { describe, expect, test } from "vitest";
import {
  createTestDeleteObjectClient,
  createTestHeadObjectClientFor,
  createTestS3Client,
} from "./fake-s3-clients";

const latency = createRuntimeObjectLowLatencyProfile();
const manifestOptions = createRuntimeObjectLowLatencyManifestOptions(latency);

describe("production object pipeline wiring", () => {
  test("wires publication, playback, health, recovery, and retention surfaces", async () => {
    let now = "2026-01-01T00:00:00.000Z";
    const deleteInputs: unknown[] = [];
    const headInputs: unknown[] = [];
    const notifier = createMemoryRuntimeCursorNotifier();
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      publicationMode: "read-gated",
      blockingReload: {
        timeoutMs: latency.blockingReloadTimeoutMs,
        waitForCursor: (context) => notifier.waitForCursor(context),
      },
      bucket: "media",
      client: createTestS3Client(),
      cursorNotifier: notifier,
      expiresInSeconds: 3,
      grantNow: () => now,
      now: () => now,
      objectClient: createTestHeadObjectClientFor(
        {
          "media/v1080/s3810.m4s": 98_304,
          "media/v1080/s3811.m4s": 98_304,
          "media/v1080/init.mp4": 1024,
        },
        headInputs
      ),
      providerId: "s3_primary",
      response: manifestOptions.response,
      retentionClient: createTestDeleteObjectClient(deleteInputs),
      store,
      ...manifestOptions.manifest,
    });

    expect(
      await status(
        handle(
          jsonRequest("https://edge.example.com/sessions", {
            mediaBaseUrl,
            session,
          })
        )
      )
    ).toBe(201);

    await publishObject(handle, initObject);
    await publishObject(handle, firstSegment);

    now = "2026-01-01T00:00:02.000Z";
    const heartbeat = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/heartbeat", {
        publisherInstanceId: "publisher_1",
      })
    );
    const health = await handle(
      new Request(
        "https://edge.example.com/sessions/session_1/health?publisherInstanceId=publisher_1"
      )
    );
    const media = await handle(
      new Request("https://edge.example.com/v1/live/session_1/v1080/media.m3u8")
    );

    expect(heartbeat.status).toBe(200);
    expect(await health.json()).toMatchObject({
      health: {
        cursorFreshness: "fresh",
        leaseStatus: "active",
        publisherInstanceId: "publisher_1",
        status: "active",
      },
    });
    expect(media.status).toBe(200);
    expect(await media.text()).toContain(
      "https://media.example.com/media/v1080/s3810.m4s"
    );

    await issueObject(handle, secondSegment);

    const plan = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/reconcile-plan",
        {
          slotIds: ["slot_3811"],
        }
      )
    );
    const recovered = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/reconcile", {
        committedAt: "2026-01-01T00:00:04.000Z",
        maxSegments: secondSegment.maxSegments,
        providerId: "s3_primary",
        slotIds: ["slot_3811"],
      })
    );

    expect(await plan.json()).toMatchObject({
      slotIds: ["slot_3811"],
      status: "planned",
    });
    expect(await recovered.json()).toMatchObject({
      summary: {
        committed: 1,
        failed: 0,
        ok: true,
        planned: 1,
      },
    });

    now = "2026-01-01T00:00:08.000Z";
    const retention = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/retention", {
        now,
      })
    );

    // Out-of-window segment was deleted inline at commit time; the explicit
    // retention call finds nothing left in state to plan against.
    expect(await retention.json()).toMatchObject({
      plan: {
        retiredObjects: [],
      },
      summary: {
        deleted: 0,
        failed: 0,
        ok: true,
        planned: 0,
      },
    });
    expect(deleteInputs).toEqual([
      {
        Bucket: "media",
        Key: firstSegment.objectKey,
      },
    ]);
    expect(headInputs).toEqual([
      { Bucket: "media", Key: initObject.objectKey },
      { Bucket: "media", Key: firstSegment.objectKey },
      { Bucket: "media", Key: secondSegment.objectKey },
    ]);
  });
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
} satisfies Session;

const mediaBaseUrl = "https://media.example.com";

interface ObjectFixture {
  commitId: string;
  deliveryUrl: string;
  duration: number;
  kind: "init" | "segment";
  maxBytes: number;
  maxSegments?: number;
  mediaSequenceNumber: number;
  objectKey: string;
  slotId: string;
}

const initObject: ObjectFixture = {
  commitId: "commit_init",
  deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
  duration: 1,
  kind: "init",
  maxBytes: 2048,
  mediaSequenceNumber: 0,
  objectKey: "media/v1080/init.mp4",
  slotId: "slot_init",
};

const firstSegment: ObjectFixture = {
  commitId: "commit_3810",
  deliveryUrl: "https://media.example.com/media/v1080/s3810.m4s",
  duration: 2,
  kind: "segment",
  maxBytes: 100_000,
  maxSegments: 1,
  mediaSequenceNumber: 3810,
  objectKey: "media/v1080/s3810.m4s",
  slotId: "slot_3810",
};

const secondSegment: ObjectFixture = {
  commitId: "commit_3811",
  deliveryUrl: "https://media.example.com/media/v1080/s3811.m4s",
  duration: 2,
  kind: "segment",
  maxBytes: 100_000,
  maxSegments: 1,
  mediaSequenceNumber: 3811,
  objectKey: "media/v1080/s3811.m4s",
  slotId: "slot_3811",
};

async function issueObject(
  handle: (request: Request) => Promise<Response>,
  object: ObjectFixture
): Promise<void> {
  const response = await handle(
    jsonRequest("https://edge.example.com/sessions/session_1/s3/slots", {
      contentType: "video/mp4",
      duration: object.duration,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: object.kind,
      maxBytes: object.maxBytes,
      mediaSequenceNumber: object.mediaSequenceNumber,
      renditionId: "v1080",
      slotId: object.slotId,
    })
  );

  if (response.status !== 201) {
    throw new Error(
      `expected ${object.slotId} slot issue to return 201, received ${response.status}`
    );
  }
}

async function publishObject(
  handle: (request: Request) => Promise<Response>,
  object: ObjectFixture
): Promise<void> {
  await issueObject(handle, object);

  const response = await handle(
    jsonRequest("https://edge.example.com/sessions/session_1/s3/commits", {
      commitId: object.commitId,
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: object.kind === "segment",
      maxSegments: object.maxSegments,
      slotId: object.slotId,
    })
  );

  if (response.status !== 201) {
    throw new Error(
      `expected ${object.slotId} commit to return 201, received ${response.status}`
    );
  }
}

async function status(response: Promise<Response>): Promise<number> {
  return (await response).status;
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
