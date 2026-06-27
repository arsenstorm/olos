import { describe, expect, test } from "bun:test";
import { createMemoryCoordinatorStore } from "../protocol";
import {
  TEST_COORDINATOR_MEDIA_BASE_URL as mediaBaseUrl,
  testCoordinatorSession as session,
} from "../protocol/coordinator-state.test-helper";
import { createRuntimeSession, type RuntimeFetch } from "../runtime";
import { runtimeFetchFor } from "../runtime/test-fetch.test-helper";
import { jsonErrorTestResponse } from "../runtime/test-http.test-helper";
import {
  applyS3RuntimeRetention,
  commitS3RuntimeUpload,
  completeS3RuntimeUpload,
  issueS3RuntimeUploadGrant,
  planS3RuntimeReconciliation,
  reconcileS3RuntimeUploads,
  S3RuntimeHttpError,
} from "./client";
import { createStoredS3CoordinatorRuntimeHandler } from "./http";
import {
  createTestHeadObjectClientFor,
  createTestS3Client,
} from "./test-client.test-helper";
import { createTestS3DeleteObjectClient } from "./test-delete-client.test-helper";

const MEDIA_ORIGIN = "https://media.example.com";
const RUNTIME_BASE_URL = "https://edge.example.com";
const S3_BUCKET = "media";
const S3_GRANT_NOW = "2026-01-01T00:00:00.000Z";
const S3_GRANT_TTL_SECONDS = 3;

describe("S3 runtime HTTP client", () => {
  test("issues S3 grants and completes uploads through the HTTP runtime", async () => {
    const headObjectInputs: unknown[] = [];
    const { clientFetch } = await createS3RuntimeClientHarness({
      headObjectInputs,
      objectSizes: {
        "live/session/v1080/3810.m4s": 98_304,
        "live/session/v1080/init.mp4": 1024,
      },
      providerId: "s3_primary",
    });

    const issued = await issueS3RuntimeUploadGrant({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      payload: {
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/live/session/v1080/init.mp4",
        duration: 1,
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "init",
        maxBytes: 2048,
        mediaSequenceNumber: 0,
        objectKey: "live/session/v1080/init.mp4",
        renditionId: "v1080",
        slotId: "slot_init",
      },
      sessionId: session.sessionId,
    });
    const segment = await issueS3RuntimeUploadGrant({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      payload: {
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
        duration: 2,
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "segment",
        maxBytes: 100_000,
        mediaSequenceNumber: 3810,
        objectKey: "live/session/v1080/3810.m4s",
        renditionId: "v1080",
        slotId: "slot_3810",
      },
      sessionId: session.sessionId,
    });
    const committed = await commitS3RuntimeUpload({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      payload: {
        commitId: "commit_init",
        committedAt: "2026-01-01T00:00:02.000Z",
        objectKey: "live/session/v1080/init.mp4",
        slotId: issued.slot.slotId,
      },
      sessionId: session.sessionId,
    });
    const completed = await completeS3RuntimeUpload({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      payload: {
        committedAt: "2026-01-01T00:00:03.000Z",
        etag: '"live/session/v1080/3810.m4s"',
        independent: true,
        objectKey: "live/session/v1080/3810.m4s",
        size: 98_304,
      },
      sessionId: session.sessionId,
      slotId: segment.slot.slotId,
    });

    expect(issued.response.status).toBe(201);
    expect(issued.grant.slotId).toBe("slot_init");
    expect(issued.slot.objectKey).toBe("live/session/v1080/init.mp4");
    expect(committed.response.status).toBe(201);
    expect(committed.commit).toMatchObject({
      commitId: "commit_init",
      objectKey: "live/session/v1080/init.mp4",
      slotId: "slot_init",
    });
    expect(completed.response.status).toBe(201);
    expect(completed.commit).toMatchObject({
      commitId: "complete_slot_3810",
      objectKey: "live/session/v1080/3810.m4s",
      slotId: "slot_3810",
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

  test("throws typed errors for failed S3 runtime responses", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(jsonErrorTestResponse("missing", 404));

    const grantError = issueS3RuntimeUploadGrant({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      payload: {
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/init.mp4",
        duration: 1,
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "init",
        maxBytes: 2048,
        mediaSequenceNumber: 0,
        objectKey: "media/init-slot_1.mp4",
        renditionId: "v1080",
        slotId: "slot_init",
      },
      sessionId: session.sessionId,
    }).catch((error: unknown) => error);

    await expect(grantError).resolves.toBeInstanceOf(S3RuntimeHttpError);
    await expect(grantError).resolves.toMatchObject({
      body: { error: { message: "missing" } },
      message: "S3 upload grant issue failed with status 404",
      status: 404,
    });

    await expect(
      commitS3RuntimeUpload({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        payload: {
          commitId: "commit_init",
          committedAt: "2026-01-01T00:00:02.000Z",
          slotId: "slot_init",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("S3 upload commit failed with status 404");

    await expect(
      planS3RuntimeReconciliation({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("S3 reconciliation plan failed with status 404");

    await expect(
      reconcileS3RuntimeUploads({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        payload: {
          committedAt: "2026-01-01T00:00:02.000Z",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("S3 upload reconciliation failed with status 404");

    await expect(
      applyS3RuntimeRetention({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        payload: {
          now: "2026-01-01T00:00:06.000Z",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("S3 retention failed with status 404");

    await expect(
      completeS3RuntimeUpload({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        sessionId: session.sessionId,
        slotId: "slot_init",
      })
    ).rejects.toThrow("S3 upload completion failed with status 404");
  });

  test("validates malformed grant responses", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            grant: {
              method: "PUT",
              url: "https://example.com/upload",
              expiresAt: "2026-01-01T00:00:00.000Z",
            },
            slot: {
              slotId: "slot_init",
            },
          }),
          { status: 201 }
        )
      );

    await expect(
      issueS3RuntimeUploadGrant({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        payload: {
          contentType: "video/mp4",
          deliveryUrl: "https://media.example.com/init.mp4",
          duration: 1,
          expiresAt: "2026-01-01T00:00:05.000Z",
          kind: "init",
          maxBytes: 2048,
          mediaSequenceNumber: 0,
          objectKey: "media/init-slot_1.mp4",
          renditionId: "v1080",
          slotId: "slot_init",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("uploadGrant.slotId");
  });

  test("validates malformed commit responses", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            commit: {
              status: "committed",
            },
          }),
          { status: 201 }
        )
      );

    await expect(
      commitS3RuntimeUpload({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        payload: {
          commitId: "commit_init",
          committedAt: "2026-01-01T00:00:02.000Z",
          slotId: "slot_init",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow('commit contains unknown property "status"');
  });

  test("validates malformed upload completion responses", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            cursor: {},
          }),
          { status: 201 }
        )
      );

    await expect(
      completeS3RuntimeUpload({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        sessionId: session.sessionId,
        slotId: "slot_init",
      })
    ).rejects.toThrow("S3 upload completion response must include a commit");
  });

  test("rejects unsafe S3 runtime route identifiers before fetch", async () => {
    let requests = 0;
    const clientFetch: RuntimeFetch = () => {
      requests += 1;
      return Promise.resolve(new Response("{}", { status: 200 }));
    };
    const options = {
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      sessionId: "../session",
    };

    await expect(planS3RuntimeReconciliation(options)).rejects.toThrow(
      "sessionId must be a non-empty URL-safe identifier"
    );
    await expect(
      completeS3RuntimeUpload({
        ...options,
        sessionId: session.sessionId,
        slotId: "../slot",
      })
    ).rejects.toThrow("slotId must be a non-empty URL-safe identifier");
    expect(requests).toBe(0);
  });

  test("plans and reconciles missed S3 uploads through the HTTP runtime", async () => {
    const headObjectInputs: unknown[] = [];
    const { clientFetch } = await createS3RuntimeClientHarness({
      headObjectInputs,
      objectSizes: {
        "live/session/v1080/3810.m4s": 98_304,
        "live/session/v1080/init.mp4": 1024,
      },
      providerId: "s3_primary",
    });

    await issueS3RuntimeUploadGrant({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      payload: {
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/live/session/v1080/init.mp4",
        duration: 1,
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "init",
        maxBytes: 2048,
        mediaSequenceNumber: 0,
        objectKey: "live/session/v1080/init.mp4",
        renditionId: "v1080",
        slotId: "slot_init",
      },
      sessionId: session.sessionId,
    });
    await issueS3RuntimeUploadGrant({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      payload: {
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
        duration: 2,
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "segment",
        maxBytes: 100_000,
        mediaSequenceNumber: 3810,
        objectKey: "live/session/v1080/3810.m4s",
        renditionId: "v1080",
        slotId: "slot_3810",
      },
      sessionId: session.sessionId,
    });

    const plan = await planS3RuntimeReconciliation({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      payload: {
        slotIds: ["slot_3810"],
      },
      sessionId: session.sessionId,
    });
    const reconciled = await reconcileS3RuntimeUploads({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      payload: {
        committedAt: "2026-01-01T00:00:02.000Z",
      },
      sessionId: session.sessionId,
    });

    expect(plan.response.status).toBe(200);
    expect(plan).toMatchObject({
      slotIds: ["slot_3810"],
      status: "planned",
    });
    expect(reconciled.response.status).toBe(202);
    expect(reconciled.summary).toMatchObject({
      committed: 2,
      failed: 0,
      ok: true,
      planned: 2,
      status: "reconciled",
    });
    expect(reconciled.results).toMatchObject([
      {
        slotId: "slot_init",
        status: "committed",
      },
      {
        slotId: "slot_3810",
        status: "committed",
      },
    ]);
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

  test("applies S3 retention through the HTTP runtime", async () => {
    const deleteInputs: unknown[] = [];
    const { clientFetch } = await createS3RuntimeClientHarness({
      deleteInputs,
      objectSizes: {
        "live/session/v1080/3810.m4s": 98_304,
        "live/session/v1080/3811.m4s": 98_304,
        "live/session/v1080/init.mp4": 1024,
      },
    });

    for (const object of [
      {
        commitId: "commit_init",
        duration: 1,
        kind: "init" as const,
        maxBytes: 2048,
        mediaSequenceNumber: 0,
        objectKey: "live/session/v1080/init.mp4",
        slotId: "slot_init",
      },
      {
        commitId: "commit_3810",
        duration: 2,
        kind: "segment" as const,
        maxBytes: 100_000,
        mediaSequenceNumber: 3810,
        objectKey: "live/session/v1080/3810.m4s",
        slotId: "slot_3810",
      },
      {
        commitId: "commit_3811",
        duration: 2,
        kind: "segment" as const,
        maxBytes: 100_000,
        mediaSequenceNumber: 3811,
        objectKey: "live/session/v1080/3811.m4s",
        slotId: "slot_3811",
      },
    ]) {
      await issueS3RuntimeUploadGrant({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        payload: {
          contentType: "video/mp4",
          deliveryUrl: `https://media.example.com/${object.objectKey}`,
          duration: object.duration,
          expiresAt: "2026-01-01T00:00:05.000Z",
          kind: object.kind,
          maxBytes: object.maxBytes,
          mediaSequenceNumber: object.mediaSequenceNumber,
          objectKey: object.objectKey,
          renditionId: "v1080",
          slotId: object.slotId,
        },
        sessionId: session.sessionId,
      });
      await commitS3RuntimeUpload({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        payload: {
          commitId: object.commitId,
          committedAt: "2026-01-01T00:00:02.000Z",
          independent: object.kind === "segment",
          objectKey: object.objectKey,
          providerId: "s3_primary",
          slotId: object.slotId,
          ...(object.kind === "segment" ? { maxSegments: 1 } : {}),
        },
        sessionId: session.sessionId,
      });
    }

    const retained = await applyS3RuntimeRetention({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      payload: {
        now: "2026-01-01T00:00:06.000Z",
      },
      sessionId: session.sessionId,
    });

    expect(retained.response.status).toBe(202);
    expect(retained.plan.retiredObjects).toEqual([
      {
        commitId: "commit_3810",
        objectKey: "live/session/v1080/3810.m4s",
        slotId: "slot_3810",
      },
    ]);
    expect(retained.summary).toEqual({
      deleted: 1,
      failed: 0,
      failedObjectKeys: [],
      failedSlotIds: [],
      ok: true,
      planned: 1,
    });
    expect(deleteInputs).toEqual([
      {
        Bucket: S3_BUCKET,
        Key: "live/session/v1080/3810.m4s",
      },
    ]);
  });

  test("validates malformed reconciliation response payloads", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [],
            summary: {
              failedErrorCodes: [],
              failedSlotIds: [],
              idempotent: 0,
              ok: true,
              planned: 0,
              slotIds: [],
              status: "reconciled",
            },
          }),
          { status: 202 }
        )
      );

    await expect(
      reconcileS3RuntimeUploads({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        payload: {
          committedAt: "2026-01-01T00:00:02.000Z",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow(
      "S3 reconciliation response summary must include committed"
    );
  });

  test("validates malformed reconciliation response result payloads", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                slotId: "slot_init",
                status: "bad_status",
              },
            ],
            summary: {
              committed: 0,
              failed: 1,
              failedErrorCodes: ["unknown_status"],
              failedSlotIds: ["slot_init"],
              idempotent: 0,
              ok: false,
              planned: 1,
              slotIds: [],
              status: "reconciled",
            },
          }),
          { status: 202 }
        )
      );

    await expect(
      reconcileS3RuntimeUploads({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        payload: {
          committedAt: "2026-01-01T00:00:02.000Z",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow(
      "S3 reconciliation response results[0] status must be committed, idempotent, or failed"
    );
  });

  test("rejects reconciliation summaries with unknown OLOS error codes", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [],
            summary: {
              committed: 0,
              failed: 1,
              failedErrorCodes: ["unknown_status"],
              failedSlotIds: ["slot_init"],
              idempotent: 0,
              ok: false,
              planned: 1,
              slotIds: ["slot_init"],
              status: "reconciled",
            },
          }),
          { status: 202 }
        )
      );

    await expect(
      reconcileS3RuntimeUploads({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        payload: {
          committedAt: "2026-01-01T00:00:02.000Z",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow(
      "S3 reconciliation response summary must include failedErrorCodes[0] must be an OLOS error code"
    );
  });

  test("validates malformed reconciliation plan response payloads", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            slotIds: [123],
            slots: [],
            status: "planned",
          }),
          { status: 200 }
        )
      );

    await expect(
      planS3RuntimeReconciliation({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("S3 reconciliation plan slotIds[0] must be a string");
  });

  test("validates malformed retention response payloads", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            plan: {
              expiredSlots: [],
              retiredObjects: [],
            },
            result: {
              deletedObjects: [],
              failedObjects: [],
            },
            summary: {
              deleted: 1,
              failed: 0,
              failedSlotIds: [],
              ok: true,
              planned: 1,
            },
          }),
          { status: 202 }
        )
      );

    await expect(
      applyS3RuntimeRetention({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        payload: {
          now: "2026-01-01T00:00:06.000Z",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow(
      "S3 retention response summary must include failedObjectKeys"
    );
  });

  test("validates malformed retention response summary counts", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            plan: {
              expiredSlots: [],
              retiredObjects: [],
            },
            result: {
              deletedObjects: [],
              failedObjects: [],
            },
            summary: {
              deleted: "1",
              failed: 0,
              failedObjectKeys: [],
              failedSlotIds: [],
              ok: true,
              planned: 1,
            },
          }),
          { status: 202 }
        )
      );

    await expect(
      applyS3RuntimeRetention({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        payload: {
          now: "2026-01-01T00:00:06.000Z",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("S3 retention response summary must include deleted");
  });

  test("validates malformed retention response result payloads", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            plan: {
              expiredSlots: [],
              retiredObjects: [],
            },
            result: {
              deletedObjects: [],
              failedObjects: [
                {
                  error: 123,
                  object: {
                    commitId: "commit_3810",
                    objectKey: "live/session/v1080/3810.m4s",
                    slotId: "slot_3810",
                  },
                },
              ],
            },
            summary: {
              deleted: 0,
              failed: 1,
              failedObjectKeys: ["live/session/v1080/3810.m4s"],
              failedSlotIds: ["slot_3810"],
              ok: false,
              planned: 1,
            },
          }),
          { status: 202 }
        )
      );

    await expect(
      applyS3RuntimeRetention({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        payload: {
          now: "2026-01-01T00:00:06.000Z",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow(
      "S3 retention response result.failedObjects[0].error must be set"
    );
  });

  test("validates malformed retention deleted object payloads", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            plan: {
              expiredSlots: [],
              retiredObjects: [],
            },
            result: {
              deletedObjects: [
                {
                  commitId: "commit_3810",
                  objectKey: 123,
                  slotId: "slot_3810",
                },
              ],
              failedObjects: [],
            },
            summary: {
              deleted: 1,
              failed: 0,
              failedObjectKeys: [],
              failedSlotIds: [],
              ok: true,
              planned: 1,
            },
          }),
          { status: 202 }
        )
      );

    await expect(
      applyS3RuntimeRetention({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        payload: {
          now: "2026-01-01T00:00:06.000Z",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow(
      "S3 retention response result.deletedObjects[0].objectKey must be set"
    );
  });
});

async function createS3RuntimeClientHarness(options: {
  deleteInputs?: unknown[];
  headObjectInputs?: unknown[];
  objectSizes: Record<string, number>;
  providerId?: string;
}): Promise<{ clientFetch: RuntimeFetch }> {
  const store = createMemoryCoordinatorStore();
  const handle = createStoredS3CoordinatorRuntimeHandler({
    allowedMediaOrigins: [MEDIA_ORIGIN],
    bucket: S3_BUCKET,
    client: createTestS3Client(),
    expiresInSeconds: S3_GRANT_TTL_SECONDS,
    grantNow: () => S3_GRANT_NOW,
    objectClient: createTestHeadObjectClientFor(
      options.headObjectInputs ?? [],
      options.objectSizes
    ),
    ...(options.providerId === undefined
      ? {}
      : { providerId: options.providerId }),
    ...(options.deleteInputs === undefined
      ? {}
      : {
          retentionClient: createTestS3DeleteObjectClient(options.deleteInputs),
        }),
    store,
  });
  const clientFetch = runtimeFetchFor(handle);

  await createRuntimeSession({
    baseUrl: RUNTIME_BASE_URL,
    fetch: clientFetch,
    mediaBaseUrl,
    session,
  });

  return { clientFetch };
}
