import { describe, expect, test } from "bun:test";
import {
  type DeleteObjectCommand,
  type DeleteObjectCommandOutput,
  type HeadObjectCommand,
  type HeadObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";

import {
  type CoordinatorPipelineState,
  commitCoordinatorUpload,
  createCoordinatorPipeline,
  createMemoryCoordinatorStore,
  issueCoordinatorSlot,
} from "../protocol";
import { createObservedUpload, createPublicationKillSwitch } from "../state";
import type { Cursor } from "../types/cursor";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import { createStoredS3CoordinatorRuntimeHandler } from "./http";
import type { S3HeadObjectClient } from "./object-observation";
import type { S3DeleteObjectClient } from "./retention";

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

describe("stored S3 coordinator runtime handler", () => {
  test("delegates runtime routes and issues S3 upload grants", async () => {
    const headObjectInputs: unknown[] = [];
    const notifiedCursors: Cursor[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        {
          "live/session/v1080/3810.m4s": 98_304,
          "live/session/v1080/init.mp4": 1024,
        },
        headObjectInputs
      ),
      cursorNotifier: {
        notify: (cursor) => notifiedCursors.push(cursor),
        waitForCursor: () =>
          Promise.reject(new Error("waiter should not be called")),
      },
      store,
    });

    const created = await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
        session,
      })
    );
    const grant = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/init.mp4",
          duration: 1,
          kind: "init",
          maxBytes: 2048,
          mediaSequenceNumber: 0,
          objectKey: "live/session/v1080/init.mp4",
          slotId: "slot_init",
        })
      )
    );
    const segmentGrant = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );
    const body = (await grant.json()) as {
      grant: {
        expiresAt: string;
        method: string;
        requiredHeaders: Record<string, string>;
        slotId: string;
        url: string;
      };
      slot: {
        objectKey: string;
        slotId: string;
        state: string;
      };
    };
    const stored = await store.load(session.sessionId);

    expect(created.status).toBe(201);
    expect(grant.status).toBe(201);
    expect(segmentGrant.status).toBe(201);
    expect(body.slot).toMatchObject({
      objectKey: "live/session/v1080/init.mp4",
      slotId: "slot_init",
      state: "issued",
    });
    expect(body.grant).toMatchObject({
      expiresAt: "2026-01-01T00:00:03.000Z",
      method: "PUT",
      requiredHeaders: {
        "Content-Type": "video/mp4",
        "If-None-Match": "*",
        "x-olos-slot-id": "slot_init",
      },
      slotId: "slot_init",
    });
    expect(new URL(body.grant.url).pathname).toBe(
      "/media/live/session/v1080/init.mp4"
    );
    expect(stored?.state.slots).toHaveLength(2);

    const initCommit = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/commits", {
        commitId: "commit_init",
        committedAt: "2026-01-01T00:00:01.000Z",
        objectKey: "live/session/v1080/init.mp4",
        providerId: "s3_primary",
        slotId: "slot_init",
      })
    );
    const segmentCommit = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/commits", {
        commitId: "commit_3810",
        committedAt: "2026-01-01T00:00:02.000Z",
        independent: true,
        objectKey: "live/session/v1080/3810.m4s",
        providerId: "s3_primary",
        slotId: "slot_3810",
      })
    );
    const committed = (await segmentCommit.json()) as {
      commit: { objectKey: string; slotId: string };
      cursor: { window: Record<string, number> };
    };

    expect(initCommit.status).toBe(201);
    expect(segmentCommit.status).toBe(201);
    expect(committed.commit).toMatchObject({
      objectKey: "live/session/v1080/3810.m4s",
      slotId: "slot_3810",
    });
    expect(committed.cursor.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(notifiedCursors.map((cursor) => cursor.window)).toEqual([
      {
        firstMediaSequenceNumber: 3810,
        lastMediaSequenceNumber: 3810,
      },
    ]);

    const playlist = await handle(
      new Request("https://edge.example.com/v1/live/session_1/v1080/media.m3u8")
    );
    const playlistBody = await playlist.text();

    expect(playlist.status).toBe(200);
    expect(playlist.headers.get("content-type")).toBe(
      "application/vnd.apple.mpegurl"
    );
    expect(playlistBody).toContain("#EXT-X-MEDIA-SEQUENCE:3810");
    expect(playlistBody).toContain(
      "https://media.example.com/live/session/v1080/3810.m4s"
    );
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "live/session/v1080/init.mp4",
      },
      {
        Bucket: "media",
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("returns S3 route errors without swallowing base routes", async () => {
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      store: createMemoryCoordinatorStore(),
    });

    expect(
      await handle(
        new Request("https://edge.example.com/sessions/missing/s3/slots")
      )
    ).toHaveProperty("status", 405);
    expect(
      await handle(
        jsonRequest(
          "https://edge.example.com/sessions/missing/s3/slots",
          slotPayload({
            deliveryUrl:
              "https://media.example.com/live/session/v1080/3810.m4s",
            duration: 2,
            kind: "segment",
            maxBytes: 100_000,
            mediaSequenceNumber: 3810,
            objectKey: "live/session/v1080/3810.m4s",
            slotId: "slot_3810",
          })
        )
      )
    ).toHaveProperty("status", 404);
    expect(
      await handle(new Request("https://edge.example.com/unknown"))
    ).toHaveProperty("status", 404);
  });

  test("returns audit metadata for oversized S3 commit rejections", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        {
          "live/session/v1080/3810.m4s": 100_001,
        },
        headObjectInputs
      ),
      store,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
        session,
      })
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );

    const response = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/commits", {
        commitId: "commit_3810",
        committedAt: "2026-01-01T00:00:02.000Z",
        providerId: "s3_primary",
        slotId: "slot_3810",
      })
    );
    const body = (await response.json()) as {
      auditEvent: {
        eventType: string;
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

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("olos.object_too_large");
    expect(body.auditEvent).toMatchObject({
      eventType: "upload.rejected",
      maxBytes: 100_000,
      objectKey: "live/session/v1080/3810.m4s",
      observedBytes: 100_001,
      reason: "object_too_large",
      slotId: "slot_3810",
    });
    expect(stored?.state.commits).toEqual([]);
    expect(stored?.state.cursor).toBeUndefined();
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("returns S3 content type mismatch commit rejections", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        {
          "live/session/v1080/3810.m4s": 98_304,
        },
        headObjectInputs,
        {
          "live/session/v1080/3810.m4s": "application/octet-stream",
        }
      ),
      store,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
        session,
      })
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );

    const response = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/commits", {
        commitId: "commit_3810",
        committedAt: "2026-01-01T00:00:02.000Z",
        providerId: "s3_primary",
        slotId: "slot_3810",
      })
    );
    const body = (await response.json()) as {
      error: {
        code: string;
        details: Record<string, unknown>;
      };
    };
    const stored = await store.load(session.sessionId);

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({
      code: "olos.content_type_mismatch",
      details: {
        contentType: "application/octet-stream",
        objectKey: "live/session/v1080/3810.m4s",
        slotContentType: "video/mp4",
        slotId: "slot_3810",
      },
    });
    expect(stored?.state.commits).toEqual([]);
    expect(stored?.state.cursor).toBeUndefined();
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("applies publication control to S3 grant issuance", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      publicationControl: createPublicationKillSwitch("incident"),
      store,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
        session,
      })
    );

    const response = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );
    const body = (await response.json()) as {
      error: {
        code: string;
        details: Record<string, unknown>;
      };
    };
    const stored = await store.load(session.sessionId);

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({
      code: "olos.security_policy_violation",
      details: {
        operation: "issue_slot",
        reason: "incident",
      },
    });
    expect(stored?.state.slots).toEqual([]);
  });

  test("routes S3 object-created event payloads", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        {
          "live/session/v1080/3810.m4s": 98_304,
          "live/session/v1080/init.mp4": 1024,
        },
        headObjectInputs
      ),
      providerId: "s3_primary",
      store,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
        session,
      })
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/init.mp4",
          duration: 1,
          kind: "init",
          maxBytes: 2048,
          mediaSequenceNumber: 0,
          objectKey: "live/session/v1080/init.mp4",
          slotId: "slot_init",
        })
      )
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );
    await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/commits", {
        commitId: "commit_init",
        committedAt: "2026-01-01T00:00:01.000Z",
        objectKey: "live/session/v1080/init.mp4",
        providerId: "s3_primary",
        slotId: "slot_init",
      })
    );

    const response = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/events",
        s3Event("live/session/v1080/3810.m4s")
      )
    );
    const body = (await response.json()) as {
      results: {
        commit?: { objectKey: string; slotId: string };
        status: string;
      }[];
    };
    const stored = await store.load(session.sessionId);

    expect(response.status).toBe(202);
    expect(body.results).toMatchObject([
      {
        commit: {
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        },
        status: "committed",
      },
    ]);
    expect(stored?.state.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "live/session/v1080/init.mp4",
      },
      {
        Bucket: "media",
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("routes duplicate and irrelevant S3 object-created events", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        {
          "live/session/v1080/3810.m4s": 98_304,
          "live/session/v1080/init.mp4": 1024,
        },
        headObjectInputs
      ),
      providerId: "s3_primary",
      store,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
        session,
      })
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/init.mp4",
          duration: 1,
          kind: "init",
          maxBytes: 2048,
          mediaSequenceNumber: 0,
          objectKey: "live/session/v1080/init.mp4",
          slotId: "slot_init",
        })
      )
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );
    await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/commits", {
        commitId: "commit_init",
        committedAt: "2026-01-01T00:00:01.000Z",
        objectKey: "live/session/v1080/init.mp4",
        providerId: "s3_primary",
        slotId: "slot_init",
      })
    );

    const response = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/events", {
        Records: [
          s3EventRecord("live/session/v1080/3810.m4s", "event_3810"),
          s3EventRecord("live/session/v1080/3810.m4s", "event_3810"),
          s3EventRecord("live/session/v1080/unused.m4s", "event_unused"),
        ],
      })
    );
    const body = (await response.json()) as {
      results: {
        commit?: { objectKey: string; slotId: string };
        error?: { code: string };
        status: string;
      }[];
    };
    const stored = await store.load(session.sessionId);

    expect(response.status).toBe(202);
    expect(body.results).toMatchObject([
      {
        commit: {
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        },
        status: "committed",
      },
      {
        commit: {
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        },
        status: "idempotent",
      },
      {
        error: {
          code: "olos.unknown_slot",
        },
        status: "rejected",
      },
    ]);
    expect(stored?.state.initCommits).toHaveLength(1);
    expect(stored?.state.commits).toMatchObject([
      {
        commitId: "event_3810",
        objectKey: "live/session/v1080/3810.m4s",
        slotId: "slot_3810",
      },
    ]);
    expect(stored?.state.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "live/session/v1080/init.mp4",
      },
      {
        Bucket: "media",
        Key: "live/session/v1080/3810.m4s",
      },
      {
        Bucket: "media",
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("reconciles missed S3 commits through the runtime route", async () => {
    const headObjectInputs: unknown[] = [];
    const notifiedCursors: Cursor[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        {
          "live/session/v1080/3810.m4s": 98_304,
          "live/session/v1080/init.mp4": 1024,
        },
        headObjectInputs
      ),
      cursorNotifier: {
        notify: (cursor) => notifiedCursors.push(cursor),
        waitForCursor: () =>
          Promise.reject(new Error("waiter should not be called")),
      },
      providerId: "s3_primary",
      store,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
        session,
      })
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/init.mp4",
          duration: 1,
          kind: "init",
          maxBytes: 2048,
          mediaSequenceNumber: 0,
          objectKey: "live/session/v1080/init.mp4",
          slotId: "slot_init",
        })
      )
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );

    const response = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/reconcile", {
        committedAt: "2026-01-01T00:00:02.000Z",
      })
    );
    const body = (await response.json()) as {
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
    const stored = await store.load(session.sessionId);

    expect(response.status).toBe(202);
    expect(body.results).toMatchObject([
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
    expect(body.summary).toMatchObject({
      committed: 2,
      failed: 0,
      ok: true,
      planned: 2,
      slotIds: ["slot_init", "slot_3810"],
    });
    expect(stored?.state.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(notifiedCursors.map((cursor) => cursor.window)).toEqual([
      {
        firstMediaSequenceNumber: 3810,
        lastMediaSequenceNumber: 3810,
      },
    ]);
  });

  test("reports idempotent S3 reconciliation through the runtime route", async () => {
    const headObjectInputs: unknown[] = [];
    const notifiedCursors: Cursor[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        {
          "live/session/v1080/3810.m4s": 98_304,
        },
        headObjectInputs
      ),
      cursorNotifier: {
        notify: (cursor) => notifiedCursors.push(cursor),
        waitForCursor: () =>
          Promise.reject(new Error("waiter should not be called")),
      },
      providerId: "s3_primary",
      store,
    });

    await store.save({
      sessionId: session.sessionId,
      state: inconsistentReconciliationState(),
    });

    const response = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/reconcile", {
        committedAt: "2026-01-01T00:00:02.000Z",
        independent: true,
      })
    );
    const body = (await response.json()) as {
      results: {
        commit?: { commitId: string; slotId: string };
        cursor?: { window: Record<string, number> };
        slotId: string;
        status: string;
      }[];
      summary: {
        committed: number;
        failed: number;
        idempotent: number;
        ok: boolean;
        planned: number;
        slotIds: string[];
      };
    };
    const stored = await store.load(session.sessionId);

    expect(response.status).toBe(202);
    expect(body.results).toMatchObject([
      {
        commit: {
          commitId: "reconcile_slot_3810",
          slotId: "slot_3810",
        },
        cursor: {
          window: {
            firstMediaSequenceNumber: 3810,
            lastMediaSequenceNumber: 3810,
          },
        },
        slotId: "slot_3810",
        status: "idempotent",
      },
    ]);
    expect(body.summary).toMatchObject({
      committed: 0,
      failed: 0,
      idempotent: 1,
      ok: true,
      planned: 1,
      slotIds: ["slot_3810"],
    });
    expect(stored?.state.commits).toHaveLength(1);
    expect(stored?.state.commits[0]?.commitId).toBe("reconcile_slot_3810");
    expect(notifiedCursors.map((cursor) => cursor.window)).toEqual([
      {
        firstMediaSequenceNumber: 3810,
        lastMediaSequenceNumber: 3810,
      },
    ]);
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("reports failed S3 reconciliation slots through the runtime route", async () => {
    const headObjectInputs: unknown[] = [];
    const notifiedCursors: Cursor[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        {
          "live/session/v1080/init.mp4": 1024,
        },
        headObjectInputs
      ),
      cursorNotifier: {
        notify: (cursor) => notifiedCursors.push(cursor),
        waitForCursor: () =>
          Promise.reject(new Error("waiter should not be called")),
      },
      providerId: "s3_primary",
      store,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
        session,
      })
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/init.mp4",
          duration: 1,
          kind: "init",
          maxBytes: 2048,
          mediaSequenceNumber: 0,
          objectKey: "live/session/v1080/init.mp4",
          slotId: "slot_init",
        })
      )
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );

    const response = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/reconcile", {
        committedAt: "2026-01-01T00:00:02.000Z",
      })
    );
    const body = (await response.json()) as {
      results: {
        error?: { message: string };
        slotId: string;
        status: string;
      }[];
      summary: {
        committed: number;
        failed: number;
        failedSlotIds: string[];
        ok: boolean;
        planned: number;
        slotIds: string[];
      };
    };
    const stored = await store.load(session.sessionId);

    expect(response.status).toBe(202);
    expect(body.results).toMatchObject([
      {
        slotId: "slot_init",
        status: "committed",
      },
      {
        error: {
          message: "unexpected object key: live/session/v1080/3810.m4s",
        },
        slotId: "slot_3810",
        status: "failed",
      },
    ]);
    expect(body.summary).toMatchObject({
      committed: 1,
      failed: 1,
      failedSlotIds: ["slot_3810"],
      ok: false,
      planned: 2,
      slotIds: ["slot_init", "slot_3810"],
    });
    expect(stored?.state.cursor).toBeUndefined();
    expect(notifiedCursors).toEqual([]);
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "live/session/v1080/init.mp4",
      },
      {
        Bucket: "media",
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("reports S3 reconciliation commit rejections through the runtime route", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        {
          "live/session/v1080/3810.m4s": 98_304,
        },
        headObjectInputs
      ),
      providerId: "s3_primary",
      store,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
        session,
      })
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 50_000,
          mediaSequenceNumber: 3810,
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );

    const response = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/reconcile", {
        committedAt: "2026-01-01T00:00:02.000Z",
      })
    );
    const body = (await response.json()) as {
      results: {
        error?: {
          code: string;
          details?: Record<string, unknown>;
          message: string;
        };
        slotId: string;
        status: string;
      }[];
      summary: {
        failed: number;
        failedSlotIds: string[];
        ok: boolean;
      };
    };
    const stored = await store.load(session.sessionId);

    expect(response.status).toBe(202);
    expect(body.results).toEqual([
      {
        error: {
          code: "olos.object_too_large",
          details: {
            maxBytes: 50_000,
            objectKey: "live/session/v1080/3810.m4s",
            size: 98_304,
            slotId: "slot_3810",
          },
          message: "object exceeds slot limit",
        },
        slotId: "slot_3810",
        status: "failed",
      },
    ]);
    expect(body.summary).toMatchObject({
      failed: 1,
      failedSlotIds: ["slot_3810"],
      ok: false,
    });
    expect(stored?.state.commits).toEqual([]);
    expect(stored?.state.cursor).toBeUndefined();
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("plans S3 reconciliation candidates through the runtime route", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      providerId: "s3_primary",
      store,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
        session,
      })
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/init.mp4",
          duration: 1,
          kind: "init",
          maxBytes: 2048,
          mediaSequenceNumber: 0,
          objectKey: "live/session/v1080/init.mp4",
          slotId: "slot_init",
        })
      )
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );

    const response = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/reconcile-plan",
        {
          slotIds: ["slot_3810"],
        }
      )
    );
    const body = (await response.json()) as {
      slotIds: string[];
      slots: { objectKey: string; slotId: string }[];
      status: string;
    };
    const stored = await store.load(session.sessionId);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      slotIds: ["slot_3810"],
      status: "planned",
    });
    expect(body.slots).toMatchObject([
      {
        objectKey: "live/session/v1080/3810.m4s",
        slotId: "slot_3810",
      },
    ]);
    expect(stored?.state.cursor).toBeUndefined();
  });

  test("executes S3 retention through the runtime route", async () => {
    const deleteInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        {
          "live/session/v1080/init.mp4": 1024,
          "live/session/v1080/3810.m4s": 98_304,
          "live/session/v1080/3811.m4s": 98_304,
          "live/session/v1080/3812.m4s": 98_304,
        },
        []
      ),
      retentionClient: deleteClientFor(deleteInputs),
      store,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
        session,
      })
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
          objectKey: object.objectKey,
          providerId: "s3_primary",
          slotId: object.slotId,
          ...(object.maxSegments === undefined
            ? {}
            : { maxSegments: object.maxSegments }),
        })
      );
    }

    const response = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/retention", {
        now: "2026-01-01T00:00:06.000Z",
      })
    );
    const body = (await response.json()) as {
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

    expect(response.status).toBe(202);
    expect(deleteInputs).toEqual([
      {
        Bucket: "media",
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
    expect(body.plan.retiredObjects).toEqual([
      {
        commitId: "commit_3810",
        objectKey: "live/session/v1080/3810.m4s",
        slotId: "slot_3810",
      },
    ]);
    expect(body.result).toEqual({
      deletedObjects: body.plan.retiredObjects,
      failedObjects: [],
    });
  });

  test("reports failed S3 retention deletes through the runtime route", async () => {
    const deleteInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      objectClient: objectClientFor(
        {
          "live/session/v1080/init.mp4": 1024,
          "live/session/v1080/3810.m4s": 98_304,
          "live/session/v1080/3811.m4s": 98_304,
          "live/session/v1080/3812.m4s": 98_304,
        },
        []
      ),
      retentionClient: deleteClientFor(
        deleteInputs,
        "live/session/v1080/3810.m4s"
      ),
      store,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
        session,
      })
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
          objectKey: object.objectKey,
          providerId: "s3_primary",
          slotId: object.slotId,
          ...(object.maxSegments === undefined
            ? {}
            : { maxSegments: object.maxSegments }),
        })
      );
    }

    const response = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/retention", {
        now: "2026-01-01T00:00:06.000Z",
      })
    );
    const body = (await response.json()) as {
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
    };

    expect(response.status).toBe(202);
    expect(deleteInputs).toEqual([
      {
        Bucket: "media",
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
    expect(body.result).toEqual({
      deletedObjects: [],
      failedObjects: [
        {
          error: "delete failed",
          object: {
            commitId: "commit_3810",
            objectKey: "live/session/v1080/3810.m4s",
            slotId: "slot_3810",
          },
        },
      ],
    });
  });
});

interface SlotPayloadOptions {
  commitId?: string;
  deliveryUrl: string;
  duration: number;
  kind: "init" | "segment";
  maxBytes: number;
  maxSegments?: number;
  mediaSequenceNumber: number;
  objectKey: string;
  slotId: string;
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
    publisherInstanceId: "pub_1",
    renditionId: "v1080",
    slotId: options.slotId,
  };
}

function inconsistentReconciliationState(): CoordinatorPipelineState {
  const initIssued = issueCoordinatorSlot({
    ...slotPayload({
      deliveryUrl: "https://media.example.com/live/session/v1080/init.mp4",
      duration: 1,
      kind: "init",
      maxBytes: 2048,
      mediaSequenceNumber: 0,
      objectKey: "live/session/v1080/init.mp4",
      slotId: "slot_init",
    }),
    state: createCoordinatorPipeline({ pathways, session }),
  });
  const initCommitted = commitCoordinatorUpload({
    commitId: "reconcile_slot_init",
    committedAt: "2026-01-01T00:00:01.000Z",
    object: createObservedUpload({
      contentType: "video/mp4",
      etag: '"live/session/v1080/init.mp4"',
      objectKey: "live/session/v1080/init.mp4",
      observedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      size: 1024,
    }),
    slotId: "slot_init",
    state: initIssued.state,
  });

  if (initCommitted.status !== "committed") {
    throw new Error("expected committed init reconciliation fixture");
  }

  const issued = issueCoordinatorSlot({
    ...slotPayload({
      deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
      duration: 2,
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKey: "live/session/v1080/3810.m4s",
      slotId: "slot_3810",
    }),
    state: initCommitted.state,
  });
  const committed = commitCoordinatorUpload({
    commitId: "reconcile_slot_3810",
    committedAt: "2026-01-01T00:00:02.000Z",
    independent: true,
    object: createObservedUpload({
      contentType: "video/mp4",
      etag: '"live/session/v1080/3810.m4s"',
      objectKey: "live/session/v1080/3810.m4s",
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      size: 98_304,
    }),
    slotId: "slot_3810",
    state: issued.state,
  });

  if (committed.status !== "committed") {
    throw new Error("expected committed reconciliation fixture");
  }

  return {
    ...committed.state,
    slots: committed.state.slots.map((slot) =>
      slot.slotId === "slot_3810"
        ? { ...slot, state: "upload_observed" as const }
        : slot
    ),
  };
}

function retentionObjects(): (SlotPayloadOptions & { commitId: string })[] {
  return [
    {
      commitId: "commit_init",
      deliveryUrl: "https://media.example.com/live/session/v1080/init.mp4",
      duration: 1,
      kind: "init",
      maxBytes: 2048,
      mediaSequenceNumber: 0,
      objectKey: "live/session/v1080/init.mp4",
      slotId: "slot_init",
    },
    {
      commitId: "commit_3810",
      deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
      duration: 2,
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKey: "live/session/v1080/3810.m4s",
      slotId: "slot_3810",
    },
    {
      commitId: "commit_3811",
      deliveryUrl: "https://media.example.com/live/session/v1080/3811.m4s",
      duration: 2,
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3811,
      objectKey: "live/session/v1080/3811.m4s",
      slotId: "slot_3811",
    },
    {
      commitId: "commit_3812",
      deliveryUrl: "https://media.example.com/live/session/v1080/3812.m4s",
      duration: 2,
      kind: "segment",
      maxBytes: 100_000,
      maxSegments: 2,
      mediaSequenceNumber: 3812,
      objectKey: "live/session/v1080/3812.m4s",
      slotId: "slot_3812",
    },
  ];
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function s3Event(objectKey: string) {
  return {
    Records: [s3EventRecord(objectKey, "event_3810")],
  };
}

function s3EventRecord(objectKey: string, eventId: string) {
  return {
    eventName: "ObjectCreated:Put",
    eventTime: "2026-01-01T00:00:02.000Z",
    responseElements: {
      "x-amz-request-id": eventId,
    },
    s3: {
      object: {
        eTag: eventId,
        key: encodeURIComponent(objectKey),
        size: 98_304,
      },
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

function objectClientFor(
  sizes: Record<string, number>,
  inputs: unknown[],
  contentTypes: Record<string, string> = {}
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
        ContentType: contentTypes[objectKey] ?? "video/mp4",
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
