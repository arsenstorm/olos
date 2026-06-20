import { describe, expect, test } from "bun:test";
import type {
  HeadObjectCommand,
  HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";

import {
  type CoordinatorPipelineState,
  type CoordinatorPipelineStore,
  commitCoordinatorUpload,
  createMemoryCoordinatorStore,
  issueCoordinatorSlot,
} from "../protocol";
import {
  createEmptyCoordinatorState,
  testCoordinatorPathways as pathways,
  testCoordinatorSession as session,
} from "../protocol/coordinator-state.test-helper";
import { createObservedUpload, createPublicationKillSwitch } from "../state";
import type { Cursor } from "../types/cursor";
import {
  createStoredS3CoordinatorRuntimeHandler,
  type StoredS3CoordinatorCommitResponse,
  type StoredS3CoordinatorEventRouteResponse,
  type StoredS3CoordinatorReconciliationResponse,
  type StoredS3CoordinatorRetentionResponse,
  type StoredS3CoordinatorSlotGrantResponse,
} from "./http";
import type { S3HeadObjectClient } from "./object-observation";
import { createTestS3Client } from "./test-client.test-helper";
import { createTestS3DeleteObjectClient } from "./test-delete-client.test-helper";

const MEDIA_ORIGIN = "https://media.example.com";
const S3_BUCKET = "media";
const S3_GRANT_NOW = "2026-01-01T00:00:00.000Z";
const S3_GRANT_TTL_SECONDS = 3;

describe("stored S3 coordinator runtime handler", () => {
  test("rejects invalid S3 handler options", () => {
    const options = {
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      store: createMemoryCoordinatorStore(),
    };

    expect(() =>
      createStoredS3CoordinatorRuntimeHandler({ ...options, bucket: "" })
    ).toThrow("bucket must be a non-empty string");
    expect(() =>
      createStoredS3CoordinatorRuntimeHandler({
        ...options,
        bucket: "media/live",
      })
    ).toThrow("bucket must not contain path separators");
    expect(() =>
      createStoredS3CoordinatorRuntimeHandler({
        ...options,
        expiresInSeconds: 0,
      })
    ).toThrow("expiresInSeconds must be a positive number");
    expect(() =>
      createStoredS3CoordinatorRuntimeHandler({
        ...options,
        providerId: "../provider",
      })
    ).toThrow("providerId must be a non-empty URL-safe identifier");
    expect(() =>
      createStoredS3CoordinatorRuntimeHandler({
        ...options,
        allowedMediaOrigins: ["http://media.example.com"],
      })
    ).toThrow("allowedMediaOrigins must contain HTTPS origins");
    expect(() =>
      createStoredS3CoordinatorRuntimeHandler({ ...options, maxAttempts: 0 })
    ).toThrow("maxAttempts must be a positive integer");
    expect(() =>
      createStoredS3CoordinatorRuntimeHandler({ ...options, targetLatency: 0 })
    ).toThrow("targetLatency must be a positive number");
    expect(() =>
      createStoredS3CoordinatorRuntimeHandler({
        ...options,
        lateToleranceMs: -1,
      })
    ).toThrow("lateToleranceMs must be a non-negative number");
  });

  test("delegates runtime routes and issues S3 upload grants", async () => {
    const headObjectInputs: unknown[] = [];
    const notifiedCursors: Cursor[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
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
    const body = (await grant.json()) as StoredS3CoordinatorSlotGrantResponse;
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
        "x-amz-meta-olos-slot-id": "slot_init",
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
    const committed =
      (await segmentCommit.json()) as StoredS3CoordinatorCommitResponse;

    expect(initCommit.status).toBe(201);
    expect(segmentCommit.status).toBe(201);
    expect(committed.commit).toMatchObject({
      objectKey: "live/session/v1080/3810.m4s",
      slotId: "slot_3810",
    });
    if (committed.cursor === undefined) {
      throw new Error("expected committed cursor");
    }

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
        Bucket: S3_BUCKET,
        Key: "live/session/v1080/init.mp4",
      },
      {
        Bucket: S3_BUCKET,
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("commits late S3 uploads within configured route tolerance", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
      objectClient: objectClientFor(
        {
          "live/session/v1080/3810.m4s": 98_304,
          "live/session/v1080/init.mp4": 1024,
        },
        [],
        {},
        {
          "live/session/v1080/3810.m4s": "2026-01-01T00:00:05.500Z",
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
      jsonRequest("https://edge.example.com/sessions/session_1/s3/commits", {
        commitId: "commit_init",
        committedAt: "2026-01-01T00:00:01.000Z",
        objectKey: "live/session/v1080/init.mp4",
        providerId: "s3_primary",
        slotId: "slot_init",
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
        committedAt: "2026-01-01T00:00:05.500Z",
        independent: true,
        lateToleranceMs: 1000,
        objectKey: "live/session/v1080/3810.m4s",
        providerId: "s3_primary",
        slotId: "slot_3810",
      })
    );
    const stored = await store.load(session.sessionId);

    expect(response.status).toBe(201);
    expect(stored?.state.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
  });

  test("accepts S3 upload-slot completion hints after object verification", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
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
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );

    const response = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/upload-slots/slot_3810/complete",
        {
          committedAt: "2026-01-01T00:00:02.000Z",
          etag: '"publisher-hint"',
          independent: true,
          objectKey: "live/session/v1080/3810.m4s",
          size: 1,
        }
      )
    );
    const body = (await response.json()) as StoredS3CoordinatorCommitResponse;

    expect(response.status).toBe(201);
    expect(body.commit).toMatchObject({
      commitId: "complete_slot_3810",
      objectKey: "live/session/v1080/3810.m4s",
      size: 98_304,
      slotId: "slot_3810",
    });
    expect(headObjectInputs).toEqual([
      {
        Bucket: S3_BUCKET,
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("rejects mismatched object keys in S3 completion hints", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
      objectClient: objectClientFor({}, headObjectInputs),
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
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );

    const response = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/upload-slots/slot_3810/complete",
        {
          committedAt: "2026-01-01T00:00:02.000Z",
          objectKey: "live/session/v1080/other.m4s",
        }
      )
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "olos.key_mismatch",
        details: {
          objectKey: "live/session/v1080/other.m4s",
          slotId: "slot_3810",
        },
        message: "object key mismatches slot",
      },
    });
    expect(headObjectInputs).toEqual([]);
  });

  test("rejects publisher media URLs in S3 completion hints", async () => {
    const headObjectInputs: unknown[] = [];
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      objectClient: objectClientFor({}, headObjectInputs),
      providerId: "s3_primary",
      store: createMemoryCoordinatorStore(),
    });

    const response = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/upload-slots/slot_3810/complete",
        {
          deliveryUrl: "https://attacker.example.com/live/3810.m3u8",
          etag: '"publisher-hint"',
          size: 98_304,
        }
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        message: "completion hint must not include deliveryUrl",
      },
    });
    expect(headObjectInputs).toEqual([]);
  });

  test("returns S3 route errors without swallowing base routes", async () => {
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
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

  test("rejects unsafe S3 route session identifiers", async () => {
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      store: createMemoryCoordinatorStore(),
    });

    const response = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/bad%20id/s3/slots",
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

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        message: "sessionId must be a non-empty URL-safe identifier",
      },
    });
  });

  test("rejects malformed S3 route percent encoding", async () => {
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      store: createMemoryCoordinatorStore(),
    });

    const response = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/%E0%A4%A/s3/slots",
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

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { message: "route path contains invalid percent encoding" },
    });
  });

  test("rejects unsafe S3 slot payload paths", async () => {
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      store: createMemoryCoordinatorStore(),
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
        session,
      })
    );

    const objectKeyResponse = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "live/session/../secret.m4s",
          slotId: "slot_3810",
        })
      )
    );
    const deliveryUrlResponse = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl:
            "https://media.example.com/live/session/v1080/3810.m4s?token=abc",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );

    expect(objectKeyResponse.status).toBe(400);
    expect(deliveryUrlResponse.status).toBe(400);
    expect(await objectKeyResponse.json()).toEqual({
      error: { message: "objectKey must be a safe relative object key" },
    });
    expect(await deliveryUrlResponse.json()).toEqual({
      error: {
        message: "deliveryUrl must not contain query strings or fragments",
      },
    });
  });

  test("rejects unsafe S3 slot payload identifiers", async () => {
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      store: createMemoryCoordinatorStore(),
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
        session,
      })
    );

    const cases = [
      {
        expected: "publisherInstanceId must be a non-empty URL-safe identifier",
        field: "publisherInstanceId",
      },
      {
        expected: "renditionId must be a non-empty URL-safe identifier",
        field: "renditionId",
      },
      {
        expected: "slotId must be a non-empty URL-safe identifier",
        field: "slotId",
      },
    ] as const;

    for (const testCase of cases) {
      const response = await handle(
        jsonRequest("https://edge.example.com/sessions/session_1/s3/slots", {
          ...slotPayload({
            deliveryUrl:
              "https://media.example.com/live/session/v1080/3810.m4s",
            duration: 2,
            kind: "segment",
            maxBytes: 100_000,
            mediaSequenceNumber: 3810,
            objectKey: "live/session/v1080/3810.m4s",
            slotId: "slot_3810",
          }),
          [testCase.field]: "../unsafe",
        })
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { message: testCase.expected },
      });
    }
  });

  test("rejects invalid S3 slot payload numbers", async () => {
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      store: createMemoryCoordinatorStore(),
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
        session,
      })
    );

    const cases = [
      {
        expected: "duration must be a positive number",
        field: "duration",
        value: 0,
      },
      {
        expected: "maxBytes must be a positive number",
        field: "maxBytes",
        value: 0,
      },
      {
        expected: "mediaSequenceNumber must be a non-negative integer",
        field: "mediaSequenceNumber",
        value: 1.5,
      },
      {
        expected: "minBytes must be a non-negative integer",
        field: "minBytes",
        value: -1,
      },
      {
        expected: "partNumber must be a non-negative integer",
        field: "partNumber",
        value: -1,
      },
    ] as const;

    for (const testCase of cases) {
      const response = await handle(
        jsonRequest(
          "https://edge.example.com/sessions/session_1/s3/slots",
          slotPayload({
            deliveryUrl:
              "https://media.example.com/live/session/v1080/3810.m4s",
            duration: 2,
            kind: "segment",
            maxBytes: 100_000,
            mediaSequenceNumber: 3810,
            objectKey: "live/session/v1080/3810.m4s",
            slotId: "slot_3810",
            [testCase.field]: testCase.value,
          })
        )
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { message: testCase.expected },
      });
    }
  });

  test("rejects invalid S3 slot publication modes", async () => {
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      store: createMemoryCoordinatorStore(),
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
        session,
      })
    );

    const response = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/slots", {
        ...slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        }),
        publicationMode: "unknown",
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        message:
          "publicationMode must be one of: direct-public, read-gated, private-upload-public-promotion",
      },
    });
  });

  test("rejects invalid S3 slot media object kinds", async () => {
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      store: createMemoryCoordinatorStore(),
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
        session,
      })
    );

    const response = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/slots", {
        ...slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        }),
        kind: "playlist",
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { message: "kind must be one of: init, part, segment, sidecar" },
    });
  });

  test("rejects playlist-like S3 uploads before issuing grants", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
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
          deliveryUrl:
            "https://media.example.com/live/session/v1080/playlist.m3u8",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "live/session/v1080/playlist.m3u8",
          slotId: "slot_playlist",
        })
      )
    );
    const stored = await store.load("session_1");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { message: "objectKey must use a supported media extension" },
    });
    expect(stored?.state.slots).toHaveLength(0);
  });

  test("returns audit metadata for oversized S3 commit rejections", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
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
    expect(stored?.state.slots).toMatchObject([
      {
        slotId: "slot_3810",
        state: "issued",
      },
    ]);
    expect(headObjectInputs).toEqual([
      {
        Bucket: S3_BUCKET,
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("returns S3 content type mismatch commit rejections", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
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
        Bucket: S3_BUCKET,
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("uses the configured S3 provider for commit routes", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
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
        slotId: "slot_3810",
      })
    );
    const body = (await response.json()) as StoredS3CoordinatorCommitResponse;

    expect(response.status).toBe(201);
    expect(body.commit).toMatchObject({
      providerId: "s3_primary",
      slotId: "slot_3810",
    });
    expect(headObjectInputs).toEqual([
      {
        Bucket: S3_BUCKET,
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("rejects S3 commit routes without a provider", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
      objectClient: objectClientFor(
        {
          "live/session/v1080/3810.m4s": 98_304,
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
        slotId: "slot_3810",
      })
    );
    const body = (await response.json()) as {
      error: {
        message: string;
      };
    };

    expect(response.status).toBe(400);
    expect(body.error.message).toBe(
      "providerId must be configured or provided"
    );
    expect(headObjectInputs).toEqual([]);
  });

  test("rejects unsafe S3 commit and reconciliation identifiers", async () => {
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      providerId: "s3_primary",
      store: createMemoryCoordinatorStore(),
    });

    const cases = [
      {
        expected: "commitId must be a non-empty URL-safe identifier",
        payload: {
          commitId: "../commit",
          committedAt: "2026-01-01T00:00:02.000Z",
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        },
        url: "https://edge.example.com/sessions/session_1/s3/commits",
      },
      {
        expected: "slotId must be a non-empty URL-safe identifier",
        payload: {
          commitId: "commit_3810",
          committedAt: "2026-01-01T00:00:02.000Z",
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "../slot",
        },
        url: "https://edge.example.com/sessions/session_1/s3/commits",
      },
      {
        expected: "providerId must be a non-empty URL-safe identifier",
        payload: {
          commitId: "commit_3810",
          committedAt: "2026-01-01T00:00:02.000Z",
          objectKey: "live/session/v1080/3810.m4s",
          providerId: "../provider",
          slotId: "slot_3810",
        },
        url: "https://edge.example.com/sessions/session_1/s3/commits",
      },
      {
        expected: "objectKey must be a safe relative object key",
        payload: {
          commitId: "commit_3810",
          committedAt: "2026-01-01T00:00:02.000Z",
          objectKey: "live/session/../secret.m4s",
          slotId: "slot_3810",
        },
        url: "https://edge.example.com/sessions/session_1/s3/commits",
      },
      {
        expected: "objectKey must be a safe relative object key",
        payload: {
          commitId: "commit_3810",
          committedAt: "2026-01-01T00:00:02.000Z",
          objectKey: "https://publisher.example.net/injected.m4s",
          slotId: "slot_3810",
        },
        url: "https://edge.example.com/sessions/session_1/s3/commits",
      },
      {
        expected: "providerId must be a non-empty URL-safe identifier",
        payload: {
          committedAt: "2026-01-01T00:00:02.000Z",
          providerId: "../provider",
        },
        url: "https://edge.example.com/sessions/session_1/s3/reconcile",
      },
      {
        expected: "slotIds must be a non-empty URL-safe identifier",
        payload: {
          committedAt: "2026-01-01T00:00:02.000Z",
          slotIds: ["../slot"],
        },
        url: "https://edge.example.com/sessions/session_1/s3/reconcile",
      },
      {
        expected: "slotIds must be a non-empty URL-safe identifier",
        payload: {
          slotIds: ["../slot"],
        },
        url: "https://edge.example.com/sessions/session_1/s3/reconcile-plan",
      },
    ] as const;

    for (const testCase of cases) {
      const response = await handle(
        jsonRequest(testCase.url, testCase.payload)
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { message: testCase.expected },
      });
    }
  });

  test("rejects invalid S3 commit and reconciliation numbers", async () => {
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      providerId: "s3_primary",
      store: createMemoryCoordinatorStore(),
    });

    const commitResponse = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/commits", {
        commitId: "commit_3810",
        committedAt: "2026-01-01T00:00:02.000Z",
        maxSegments: 0,
        objectKey: "live/session/v1080/3810.m4s",
        slotId: "slot_3810",
      })
    );
    const reconciliationResponse = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/reconcile", {
        committedAt: "2026-01-01T00:00:02.000Z",
        maxSegments: 1.5,
      })
    );
    const commitLateToleranceResponse = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/commits", {
        commitId: "commit_3810",
        committedAt: "2026-01-01T00:00:02.000Z",
        lateToleranceMs: -1,
        objectKey: "live/session/v1080/3810.m4s",
        slotId: "slot_3810",
      })
    );
    const reconciliationLateToleranceResponse = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/reconcile", {
        committedAt: "2026-01-01T00:00:02.000Z",
        lateToleranceMs: -1,
      })
    );

    expect(commitResponse.status).toBe(400);
    expect(reconciliationResponse.status).toBe(400);
    expect(commitLateToleranceResponse.status).toBe(400);
    expect(reconciliationLateToleranceResponse.status).toBe(400);
    expect(await commitResponse.json()).toEqual({
      error: { message: "maxSegments must be a positive integer" },
    });
    expect(await reconciliationResponse.json()).toEqual({
      error: { message: "maxSegments must be a positive integer" },
    });
    expect(await commitLateToleranceResponse.json()).toEqual({
      error: { message: "lateToleranceMs must be a non-negative number" },
    });
    expect(await reconciliationLateToleranceResponse.json()).toEqual({
      error: { message: "lateToleranceMs must be a non-negative number" },
    });
  });

  test("rejects invalid S3 timestamp inputs", async () => {
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      providerId: "s3_primary",
      store: createMemoryCoordinatorStore(),
    });

    const cases = [
      {
        expected: "committedAt must be a valid timestamp",
        payload: {
          commitId: "commit_3810",
          committedAt: "soon",
          objectKey: "live/session/v1080/3810.m4s",
          slotId: "slot_3810",
        },
        url: "https://edge.example.com/sessions/session_1/s3/commits",
      },
      {
        expected: "programDateTime must be a valid timestamp",
        payload: {
          commitId: "commit_3810",
          committedAt: "2026-01-01T00:00:02.000Z",
          objectKey: "live/session/v1080/3810.m4s",
          programDateTime: "soon",
          slotId: "slot_3810",
        },
        url: "https://edge.example.com/sessions/session_1/s3/commits",
      },
      {
        expected: "committedAt must be a valid timestamp",
        payload: {
          committedAt: "soon",
        },
        url: "https://edge.example.com/sessions/session_1/s3/reconcile",
      },
      {
        expected: "now must be a valid timestamp",
        payload: {
          now: "soon",
        },
        url: "https://edge.example.com/sessions/session_1/s3/retention",
      },
    ] as const;

    for (const testCase of cases) {
      const response = await handle(
        jsonRequest(testCase.url, testCase.payload)
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { message: testCase.expected },
      });
    }
  });

  test("applies publication control to S3 grant issuance", async () => {
    const store = createMemoryCoordinatorStore();
    await store.save({
      sessionId: session.sessionId,
      state: committedSegmentState(),
    });

    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      publicationControl: createPublicationKillSwitch("incident"),
      store,
    });

    const before = await handle(
      new Request("https://edge.example.com/v1/live/session_1/v1080/media.m3u8")
    );
    const response = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/live/session/v1080/3811.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3811,
          objectKey: "live/session/v1080/3811.m4s",
          slotId: "slot_3811",
        })
      )
    );
    const after = await handle(
      new Request("https://edge.example.com/v1/live/session_1/v1080/media.m3u8")
    );
    const body = (await response.json()) as {
      error: {
        code: string;
        details: Record<string, unknown>;
      };
    };
    const stored = await store.load(session.sessionId);
    const beforeBody = await before.text();
    const afterBody = await after.text();

    expect(before.status).toBe(200);
    expect(response.status).toBe(409);
    expect(after.status).toBe(200);
    expect(body.error).toMatchObject({
      code: "olos.security_policy_violation",
      details: {
        operation: "issue_slot",
        reason: "incident",
      },
    });
    expect(beforeBody).toContain("live/session/v1080/3810.m4s");
    expect(afterBody).toBe(beforeBody);
    expect(afterBody).not.toContain("live/session/v1080/3811.m4s");
    expect(
      stored?.state.slots.some((slot) => slot.slotId === "slot_3811")
    ).toBe(false);
  });

  test("rejects S3 event payloads for unexpected buckets", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      providerId: "s3_primary",
      store,
    });

    const response = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/events",
        s3Event("live/session/v1080/3810.m4s", "archive")
      )
    );
    const body =
      (await response.json()) as StoredS3CoordinatorEventRouteResponse;

    expect(response.status).toBe(202);
    expect(body.results).toEqual([
      {
        error: {
          code: "olos.invalid_state",
          message: "s3 event bucket does not match expected bucket",
        },
        status: "invalid_event",
      },
    ]);
  });

  test("routes S3 object-created event payloads", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
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
    const body =
      (await response.json()) as StoredS3CoordinatorEventRouteResponse;
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
        Bucket: S3_BUCKET,
        Key: "live/session/v1080/init.mp4",
      },
      {
        Bucket: S3_BUCKET,
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("reports S3 event commit policy rejections", async () => {
    const headObjectInputs: unknown[] = [];
    const notifiedCursors: Cursor[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      commitPolicy: ({ slot }) =>
        slot.kind === "init"
          ? { status: "allowed" }
          : {
              error: {
                error: {
                  code: "olos.quota_exceeded",
                  details: {
                    publisherInstanceId: slot.publisherInstanceId,
                  },
                  message: "tenant quota exceeded",
                },
              },
              status: "rejected",
            },
      cursorNotifier: {
        notify: (cursor) => notifiedCursors.push(cursor),
        waitForCursor: () =>
          Promise.reject(new Error("waiter should not be called")),
      },
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
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
    const body =
      (await response.json()) as StoredS3CoordinatorEventRouteResponse;
    const stored = await store.load(session.sessionId);

    expect(response.status).toBe(202);
    expect(body.results).toMatchObject([
      {
        error: {
          code: "olos.quota_exceeded",
          details: {
            publisherInstanceId: "pub_1",
          },
          message: "tenant quota exceeded",
        },
        status: "rejected",
      },
    ]);
    expect(stored?.state.initCommits).toHaveLength(1);
    expect(stored?.state.commits).toEqual([]);
    expect(stored?.state.cursor).toBeUndefined();
    expect(
      stored?.state.slots.find((slot) => slot.slotId === "slot_3810")
    ).toMatchObject({
      slotId: "slot_3810",
      state: "issued",
    });
    expect(notifiedCursors).toEqual([]);
    expect(headObjectInputs).toEqual([
      {
        Bucket: S3_BUCKET,
        Key: "live/session/v1080/init.mp4",
      },
      {
        Bucket: S3_BUCKET,
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("routes duplicate and irrelevant S3 object-created events", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
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
    const body =
      (await response.json()) as StoredS3CoordinatorEventRouteResponse;
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
        Bucket: S3_BUCKET,
        Key: "live/session/v1080/init.mp4",
      },
      {
        Bucket: S3_BUCKET,
        Key: "live/session/v1080/3810.m4s",
      },
      {
        Bucket: S3_BUCKET,
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("retries S3 object-created events after store conflicts", async () => {
    const headObjectInputs: unknown[] = [];
    const innerStore = createMemoryCoordinatorStore();
    let failNextSave = false;
    let saves = 0;
    const store: CoordinatorPipelineStore = {
      load: (sessionId) => innerStore.load(sessionId),
      save: async (options) => {
        saves += 1;

        if (failNextSave) {
          failNextSave = false;
          return {
            current: await innerStore.load(options.sessionId),
            status: "conflict",
          };
        }

        return await innerStore.save(options);
      },
    };
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
      maxAttempts: 2,
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

    failNextSave = true;
    const savesBeforeEvent = saves;
    const response = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/events",
        s3Event("live/session/v1080/3810.m4s")
      )
    );
    const body =
      (await response.json()) as StoredS3CoordinatorEventRouteResponse;
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
    expect(saves - savesBeforeEvent).toBe(2);
    expect(stored?.state.commits).toMatchObject([
      {
        commitId: "event_3810",
        objectKey: "live/session/v1080/3810.m4s",
        slotId: "slot_3810",
      },
    ]);
  });

  test("reconciles missed S3 commits through the runtime route", async () => {
    const headObjectInputs: unknown[] = [];
    const notifiedCursors: Cursor[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
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
    const body =
      (await response.json()) as StoredS3CoordinatorReconciliationResponse;
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
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
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
    const body =
      (await response.json()) as StoredS3CoordinatorReconciliationResponse;
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
        Bucket: S3_BUCKET,
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("reports failed S3 reconciliation slots through the runtime route", async () => {
    const headObjectInputs: unknown[] = [];
    const notifiedCursors: Cursor[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
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
    const body =
      (await response.json()) as StoredS3CoordinatorReconciliationResponse;
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
        Bucket: S3_BUCKET,
        Key: "live/session/v1080/init.mp4",
      },
      {
        Bucket: S3_BUCKET,
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("reports S3 reconciliation commit rejections through the runtime route", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
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
    const body =
      (await response.json()) as StoredS3CoordinatorReconciliationResponse;
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
        Bucket: S3_BUCKET,
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("applies commit policy to S3 reconciliation runtime commits", async () => {
    const headObjectInputs: unknown[] = [];
    const notifiedCursors: Cursor[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      commitPolicy: () => ({
        error: {
          error: {
            code: "olos.quota_exceeded",
            message: "tenant quota exceeded",
          },
        },
        status: "rejected",
      }),
      cursorNotifier: {
        notify: (cursor) => notifiedCursors.push(cursor),
        waitForCursor: () =>
          Promise.reject(new Error("waiter should not be called")),
      },
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
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
    const body =
      (await response.json()) as StoredS3CoordinatorReconciliationResponse;
    const stored = await store.load(session.sessionId);

    expect(response.status).toBe(202);
    expect(body.results).toEqual([
      {
        error: {
          code: "olos.quota_exceeded",
          message: "tenant quota exceeded",
        },
        slotId: "slot_3810",
        status: "failed",
      },
    ]);
    expect(body.summary).toMatchObject({
      failed: 1,
      failedErrorCodes: ["olos.quota_exceeded"],
      failedSlotIds: ["slot_3810"],
      ok: false,
    });
    expect(stored?.state.commits).toEqual([]);
    expect(stored?.state.cursor).toBeUndefined();
    expect(notifiedCursors).toEqual([]);
    expect(headObjectInputs).toEqual([
      {
        Bucket: S3_BUCKET,
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("plans S3 reconciliation candidates through the runtime route", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
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
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
      objectClient: objectClientFor(
        {
          "live/session/v1080/init.mp4": 1024,
          "live/session/v1080/3810.m4s": 98_304,
          "live/session/v1080/3811.m4s": 98_304,
          "live/session/v1080/3812.m4s": 98_304,
        },
        []
      ),
      retentionClient: createTestS3DeleteObjectClient(deleteInputs),
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
    const body =
      (await response.json()) as StoredS3CoordinatorRetentionResponse;

    expect(response.status).toBe(202);
    expect(deleteInputs).toEqual([
      {
        Bucket: S3_BUCKET,
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
    expect(body.summary).toEqual({
      deleted: 1,
      failed: 0,
      failedObjectKeys: [],
      failedSlotIds: [],
      ok: true,
      planned: 1,
    });
  });

  test("reports failed S3 retention deletes through the runtime route", async () => {
    const deleteInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      grantNow: () => S3_GRANT_NOW,
      objectClient: objectClientFor(
        {
          "live/session/v1080/init.mp4": 1024,
          "live/session/v1080/3810.m4s": 98_304,
          "live/session/v1080/3811.m4s": 98_304,
          "live/session/v1080/3812.m4s": 98_304,
        },
        []
      ),
      retentionClient: createTestS3DeleteObjectClient(
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

    const before = await store.load(session.sessionId);
    const response = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/s3/retention", {
        now: "2026-01-01T00:00:06.000Z",
      })
    );
    const body =
      (await response.json()) as StoredS3CoordinatorRetentionResponse;
    const after = await store.load(session.sessionId);

    expect(response.status).toBe(202);
    expect(deleteInputs).toEqual([
      {
        Bucket: S3_BUCKET,
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
    expect(body.summary).toEqual({
      deleted: 0,
      failed: 1,
      failedObjectKeys: ["live/session/v1080/3810.m4s"],
      failedSlotIds: ["slot_3810"],
      ok: false,
      planned: 1,
    });
    expect(after?.state.cursor).toEqual(before?.state.cursor);
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
  minBytes?: number;
  objectKey: string;
  partNumber?: number;
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
    ...(options.minBytes === undefined ? {} : { minBytes: options.minBytes }),
    objectKey: options.objectKey,
    ...(options.partNumber === undefined
      ? {}
      : { partNumber: options.partNumber }),
    publicationMode: "direct-public" as const,
    publisherInstanceId: "pub_1",
    renditionId: "v1080",
    slotId: options.slotId,
  };
}

function committedSegmentState(): CoordinatorPipelineState {
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
    state: createEmptyCoordinatorState(),
  });
  const initCommitted = commitCoordinatorUpload({
    commitId: "commit_init",
    committedAt: "2026-01-01T00:00:01.000Z",
    object: createObservedUpload({
      contentType: "video/mp4",
      objectKey: "live/session/v1080/init.mp4",
      observedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      size: 1024,
    }),
    slotId: "slot_init",
    state: initIssued.state,
  });

  if (initCommitted.status !== "committed") {
    throw new Error("expected committed init fixture");
  }

  const segmentIssued = issueCoordinatorSlot({
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
  const segmentCommitted = commitCoordinatorUpload({
    commitId: "commit_3810",
    committedAt: "2026-01-01T00:00:02.000Z",
    independent: true,
    object: createObservedUpload({
      contentType: "video/mp4",
      objectKey: "live/session/v1080/3810.m4s",
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      size: 98_304,
    }),
    slotId: "slot_3810",
    state: segmentIssued.state,
  });

  if (segmentCommitted.status !== "committed") {
    throw new Error("expected committed segment fixture");
  }

  return segmentCommitted.state;
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
    state: createEmptyCoordinatorState(),
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

function s3Event(objectKey: string, bucket = "media") {
  return {
    Records: [s3EventRecord(objectKey, "event_3810", bucket)],
  };
}

function s3EventRecord(objectKey: string, eventId: string, bucket = "media") {
  return {
    eventName: "ObjectCreated:Put",
    eventTime: "2026-01-01T00:00:02.000Z",
    responseElements: {
      "x-amz-request-id": eventId,
    },
    s3: {
      bucket: {
        name: bucket,
      },
      object: {
        eTag: eventId,
        key: encodeURIComponent(objectKey),
        size: 98_304,
      },
    },
  };
}

function objectClientFor(
  sizes: Record<string, number>,
  inputs: unknown[],
  contentTypes: Record<string, string> = {},
  lastModified: Record<string, string> = {}
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
        LastModified: new Date(
          lastModified[objectKey] ?? "2026-01-01T00:00:01.000Z"
        ),
      });
    },
  };
}
