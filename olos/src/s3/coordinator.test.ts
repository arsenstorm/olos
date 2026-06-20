import { describe, expect, test } from "bun:test";
import type {
  HeadObjectCommand,
  HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import {
  type CoordinatorPipelineStore,
  createMemoryCoordinatorStore,
  issueCoordinatorSlot,
} from "../protocol/coordinator";
import {
  createCoordinatorStateWithIssuedSegment,
  createEmptyCoordinatorState,
  testCoordinatorSession as session,
} from "../protocol/coordinator-state.test-helper";
import { resolveRuntimePublisherObjectExpiry } from "../runtime/publisher-expiry";
import { createRuntimePublisherObjectPlan } from "../runtime/publisher-plan";
import { normalizeUploadEvent } from "../state/observed-upload";
import { createPublicationKillSwitch } from "../state/publication-control";
import {
  commitS3CoordinatorUpload,
  commitStoredS3CoordinatorUpload,
  completeStoredS3CoordinatorUpload,
  completeStoredS3CoordinatorUploadByObjectKey,
  issueS3CoordinatorUploadGrant,
  issueStoredS3CoordinatorUploadGrant,
  routeStoredS3CoordinatorUploadEvent,
} from "./coordinator";
import type { S3HeadObjectClient } from "./object-observation";
import { createTestS3Client } from "./test-client.test-helper";

const publishNow = "2026-01-01T00:00:00.000Z";
const mediaOrigin = "https://media.example.com";
const s3GrantTtlSeconds = 3;
const targetLatency = 3;

describe("s3 coordinator uploads", () => {
  test("issues and persists an S3 coordinator upload grant", async () => {
    const store = createMemoryCoordinatorStore();
    const state = createEmptyCoordinatorState();
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const issue = await issueStoredS3CoordinatorUploadGrant({
      bucket: "media",
      client: createTestS3Client(),
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      expiresInSeconds: s3GrantTtlSeconds,
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      now: publishNow,
      objectKey: "live/session/v1080/3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store,
    });

    expect(issue.status).toBe("saved");
    if (issue.status !== "saved") {
      throw new Error("expected stored grant issue");
    }

    const stored = await store.load(session.sessionId);

    expect(issue.etag).toBe("2");
    expect(issue.grant.slotId).toBe("slot_3810");
    expect(issue.grant.requiredHeaders).toMatchObject({
      "x-amz-meta-olos-slot-id": "slot_3810",
      "x-olos-slot-id": "slot_3810",
    });
    expect(issue.slot.objectKey).toBe("live/session/v1080/3810.m4s");
    expect(stored?.etag).toBe("2");
    expect(stored?.state.slots).toEqual([issue.slot]);
  });

  test("issues planned part objects through stored S3 grants", async () => {
    const store = createMemoryCoordinatorStore();
    const state = createEmptyCoordinatorState();
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const expiry = resolveRuntimePublisherObjectExpiry({
      duration: 0.5,
      now: publishNow,
      targetLatency,
    });
    const plan = createRuntimePublisherObjectPlan({
      baseUrl: "https://media.example.com",
      contentType: "video/iso.segment",
      duration: 0.5,
      expiresAt: expiry.expiresAt,
      extension: "m4s",
      kind: "part",
      maxBytes: 25_000,
      mediaSequenceNumber: 3811,
      objectKeyNonce: "slot_part",
      objectKeyPrefix: "live/session",
      partNumber: 0,
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
    });
    const issue = await issueStoredS3CoordinatorUploadGrant({
      bucket: "media",
      client: createTestS3Client(),
      expiresInSeconds: expiry.ttlSeconds,
      now: publishNow,
      sessionId: session.sessionId,
      ...plan.slot,
      store,
    });

    expect(issue.status).toBe("saved");
    if (issue.status !== "saved") {
      throw new Error("expected planned part grant issue");
    }

    const url = new URL(issue.grant.url);
    const stored = await store.load(session.sessionId);

    expect(issue.slot).toMatchObject({
      kind: "part",
      objectKey: plan.slot.objectKey,
      partNumber: 0,
      slotId: plan.slot.slotId,
    });
    expect(issue.grant.slotId).toBe(plan.slot.slotId);
    expect(url.pathname).toBe(`/media/${plan.slot.objectKey}`);
    expect(stored?.state.slots).toEqual([issue.slot]);
  });

  test("does not sign stored S3 grants for missing coordinator sessions", async () => {
    const result = await issueStoredS3CoordinatorUploadGrant({
      bucket: "media",
      client: createTestS3Client(),
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      expiresInSeconds: s3GrantTtlSeconds,
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      now: publishNow,
      objectKey: "live/session/v1080/3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store: createMemoryCoordinatorStore(),
    });

    expect(result).toEqual({ status: "not_found" });
  });

  test("does not issue stored S3 grants while the kill switch is active", async () => {
    const store = createMemoryCoordinatorStore();
    const state = createEmptyCoordinatorState();
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const result = await issueStoredS3CoordinatorUploadGrant({
      bucket: "media",
      client: createTestS3Client(),
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      expiresInSeconds: s3GrantTtlSeconds,
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      now: publishNow,
      objectKey: "live/session/v1080/3810.m4s",
      publicationControl: createPublicationKillSwitch("incident"),
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store,
    });
    const stored = await store.load(session.sessionId);

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected rejected grant issue");
    }

    expect(result.error.error).toMatchObject({
      code: "olos.security_policy_violation",
      details: {
        operation: "issue_slot",
        reason: "incident",
      },
    });
    expect(stored?.etag).toBe("1");
    expect(stored?.state.slots).toEqual([]);
  });

  test("issues a coordinator slot with an S3 upload grant", async () => {
    const state = createEmptyCoordinatorState();
    const issue = await issueS3CoordinatorUploadGrant({
      bucket: "media",
      client: createTestS3Client(),
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      expiresInSeconds: s3GrantTtlSeconds,
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      now: publishNow,
      objectKey: "live/session/v1080/3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_3810",
      state,
    });
    const url = new URL(issue.grant.url);

    expect(issue.slot).toMatchObject({
      objectKey: "live/session/v1080/3810.m4s",
      slotId: "slot_3810",
      state: "issued",
    });
    expect(issue.state.slots).toEqual([issue.slot]);
    expect(issue.grant).toMatchObject({
      expiresAt: "2026-01-01T00:00:03.000Z",
      method: "PUT",
      requiredHeaders: {
        "Content-Type": "video/mp4",
        "If-None-Match": "*",
        "x-olos-slot-id": "slot_3810",
      },
      slotId: "slot_3810",
    });
    expect(url.pathname).toBe("/media/live/session/v1080/3810.m4s");
  });

  test("observes the issued S3 object before committing", async () => {
    const headObjectInputs: unknown[] = [];
    let state = createEmptyCoordinatorState();
    state = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/init.mp4",
      duration: 1,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "init",
      maxBytes: 2048,
      mediaSequenceNumber: 0,
      objectKey: "media/init.mp4",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_init",
      state,
    }).state;

    const initCommit = await commitS3CoordinatorUpload({
      bucket: "media",
      client: clientFor("media/init.mp4", 1024, headObjectInputs),
      commitId: "commit_init",
      committedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      slotId: "slot_init",
      state,
    });

    if (initCommit.status !== "committed") {
      throw new Error("expected init commit");
    }

    state = initCommit.state;
    state = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/s3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKey: "media/s3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_3810",
      state,
    }).state;

    const segmentCommit = await commitS3CoordinatorUpload({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: true,
      providerId: "s3_primary",
      slotId: "slot_3810",
      state,
    });

    expect(segmentCommit.status).toBe("committed");
    if (segmentCommit.status !== "committed") {
      throw new Error("expected segment commit");
    }

    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/init.mp4",
      },
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
    expect(segmentCommit.commit.objectKey).toBe("media/s3810.m4s");
    expect(segmentCommit.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
  });

  test("observes and persists S3 coordinator upload commits", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    let state = createEmptyCoordinatorState();
    state = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/init.mp4",
      duration: 1,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "init",
      maxBytes: 2048,
      mediaSequenceNumber: 0,
      objectKey: "media/init.mp4",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_init",
      state,
    }).state;
    state = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/s3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKey: "media/s3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_3810",
      state,
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const initCommit = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: clientFor("media/init.mp4", 1024, headObjectInputs),
      commitId: "commit_init",
      committedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_init",
      store,
    });
    const segmentCommit = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: true,
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store,
    });

    expect(initCommit.status).toBe("committed");
    expect(segmentCommit.status).toBe("committed");
    if (segmentCommit.status !== "committed") {
      throw new Error("expected persisted segment commit");
    }

    const stored = await store.load(session.sessionId);

    expect(segmentCommit.etag).toBe("3");
    expect(stored?.etag).toBe("3");
    expect(stored?.state.commits).toEqual([segmentCommit.commit]);
    expect(stored?.state.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/init.mp4",
      },
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
  });

  test("retries stored S3 commits after save conflicts with current state", async () => {
    const headObjectInputs: unknown[] = [];
    const store = await createCommitConflictingStore();

    const result = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: true,
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store,
    });

    expect(result.status).toBe("committed");
    if (result.status !== "committed") {
      throw new Error("expected committed S3 upload after conflict retry");
    }

    expect(result.state.slots.map((slot) => slot.slotId)).toEqual([
      "slot_init",
      "slot_3810",
      "slot_3811",
    ]);
    expect(result.state.commits).toHaveLength(1);
    expect(result.state.commits[0]).toMatchObject({
      commitId: "commit_3810",
      objectKey: "media/s3810.m4s",
      slotId: "slot_3810",
    });
    expect(result.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
  });

  test("rejects invalid stored S3 commit attempt limits", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    await store.save({
      sessionId: session.sessionId,
      state: createCoordinatorStateWithIssuedSegment(),
    });

    await expect(
      commitStoredS3CoordinatorUpload({
        bucket: "media",
        client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
        commitId: "commit_3810",
        committedAt: "2026-01-01T00:00:02.000Z",
        maxAttempts: 0,
        providerId: "s3_primary",
        sessionId: session.sessionId,
        slotId: "slot_3810",
        store,
      })
    ).rejects.toThrow("maxAttempts must be a positive integer");
    await expect(
      commitStoredS3CoordinatorUpload({
        bucket: "media",
        client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
        commitId: "commit_3810",
        committedAt: "2026-01-01T00:00:02.000Z",
        maxAttempts: 1.5,
        providerId: "s3_primary",
        sessionId: session.sessionId,
        slotId: "slot_3810",
        store,
      })
    ).rejects.toThrow("maxAttempts must be a positive integer");
    expect(headObjectInputs).toEqual([]);
  });

  test("commits duplicate stored S3 uploads idempotently", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();

    await store.save({
      sessionId: session.sessionId,
      state: createCoordinatorStateWithIssuedSegment(),
    });

    const committed = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: true,
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store,
    });
    const duplicate = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
      commitId: "commit_3810_retry",
      committedAt: "2026-01-01T00:00:03.000Z",
      independent: true,
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store,
    });
    const stored = await store.load(session.sessionId);

    expect(committed.status).toBe("committed");
    expect(duplicate.status).toBe("idempotent");
    if (committed.status !== "committed" || duplicate.status !== "idempotent") {
      throw new Error("expected idempotent duplicate S3 commit");
    }

    expect(duplicate.commit).toEqual(committed.commit);
    expect(duplicate.etag).toBe(committed.etag);
    expect(stored?.etag).toBe(committed.etag);
    expect(stored?.state.commits).toEqual([committed.commit]);
    expect(stored?.state.cursor).toEqual(committed.cursor);
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
  });

  test("rejects oversized stored S3 uploads without committing them", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const state = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/s3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKey: "media/s3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_3810",
      state: createEmptyCoordinatorState(),
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const result = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 100_001, headObjectInputs),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store,
    });
    const stored = await store.load(session.sessionId);

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected oversized upload rejection");
    }

    expect(result.error.error).toEqual({
      code: "olos.object_too_large",
      details: {
        maxBytes: 100_000,
        objectKey: "media/s3810.m4s",
        size: 100_001,
        slotId: "slot_3810",
      },
      message: "object exceeds slot limit",
    });
    expect(result.auditEvent).toEqual({
      error: result.error,
      eventType: "upload.rejected",
      maxBytes: 100_000,
      objectKey: "media/s3810.m4s",
      observedBytes: 100_001,
      occurredAt: "2026-01-01T00:00:02.000Z",
      reason: "object_too_large",
      slotId: "slot_3810",
    });
    expect(stored?.etag).toBe("1");
    expect(stored?.state.commits).toEqual([]);
    expect(stored?.state.cursor).toBeUndefined();
    expect(stored?.state.slots).toEqual(state.slots);
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
  });

  test("rejects stored S3 uploads with mismatched content types", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const state = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/s3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKey: "media/s3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_3810",
      state: createEmptyCoordinatorState(),
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const result = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: clientFor(
        "media/s3810.m4s",
        98_304,
        headObjectInputs,
        "application/octet-stream"
      ),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store,
    });
    const stored = await store.load(session.sessionId);

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected content type rejection");
    }

    expect(result.error.error).toEqual({
      code: "olos.content_type_mismatch",
      details: {
        contentType: "application/octet-stream",
        objectKey: "media/s3810.m4s",
        slotContentType: "video/mp4",
        slotId: "slot_3810",
      },
      message: "object content type does not match slot",
    });
    expect(stored?.etag).toBe("1");
    expect(stored?.state.commits).toEqual([]);
    expect(stored?.state.cursor).toBeUndefined();
    expect(stored?.state.slots).toEqual(state.slots);
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
  });

  test("rejects stored S3 uploads with mismatched slot metadata", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const state = issueCoordinatorSlot({
      ...segmentSlot(),
      state: createEmptyCoordinatorState(),
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const result = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: clientFor(
        "media/s3810.m4s",
        98_304,
        headObjectInputs,
        "video/mp4",
        {
          "x-amz-meta-olos-slot-id": "slot_other",
        }
      ),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store,
    });
    const stored = await store.load(session.sessionId);

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected metadata mismatch rejection");
    }

    expect(result.error.error).toEqual({
      code: "olos.invalid_state",
      details: {
        objectKey: "media/s3810.m4s",
        observedSlotId: "slot_other",
        slotId: "slot_3810",
      },
      message: "object slot metadata does not match slot",
    });
    expect(stored?.etag).toBe("1");
    expect(stored?.state.commits).toEqual([]);
    expect(stored?.state.cursor).toBeUndefined();
    expect(stored?.state.slots).toEqual(state.slots);
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
  });

  test("derives manifests from stored S3 coordinator commits", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    let state = createEmptyCoordinatorState();
    state = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/init.mp4",
      duration: 1,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "init",
      maxBytes: 2048,
      mediaSequenceNumber: 0,
      objectKey: "media/init.mp4",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_init",
      state,
    }).state;
    state = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/s3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKey: "media/s3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_3810",
      state,
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: clientFor("media/init.mp4", 1024, headObjectInputs),
      commitId: "commit_init",
      committedAt: "2026-01-01T00:00:01.000Z",
      manifest: {
        allowedMediaOrigins: [mediaOrigin],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_init",
      store,
    });

    const segmentCommit = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: true,
      manifest: {
        allowedMediaOrigins: [mediaOrigin],
        partTarget: session.partTarget,
        response: {
          maxAgeSeconds: 2,
          targetLatencySeconds: 3,
        },
        segmentTarget: session.segmentTarget,
      },
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store,
    });

    expect(segmentCommit.status).toBe("committed");
    if (segmentCommit.status !== "committed") {
      throw new Error("expected persisted segment commit");
    }

    expect(
      segmentCommit.manifest?.artifacts.map((artifact) => artifact.path)
    ).toEqual([
      "/v1/live/session_1/master.m3u8",
      "/v1/live/session_1/v1080/media.m3u8",
    ]);
    expect(segmentCommit.manifest?.artifacts[1]?.body).toContain(
      "https://media.example.com/s3810.m4s"
    );
    expect(segmentCommit.manifest?.artifacts[1]?.response.headers).toEqual({
      "cache-control": "public, max-age=2, must-revalidate",
      "content-type": "application/vnd.apple.mpegurl",
    });
  });

  test("completes stored S3 uploads from a matching object key hint", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    let state = createEmptyCoordinatorState();
    state = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/s3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKey: "media/s3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_3810",
      state,
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const result = await completeStoredS3CoordinatorUpload({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      objectKey: "media/s3810.m4s",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store,
    });

    expect(result.status).toBe("committed");
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
  });

  test("rejects stored S3 completion hints with mismatched object keys", async () => {
    const store = createMemoryCoordinatorStore();
    const state = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/s3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKey: "media/s3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_3810",
      state: createEmptyCoordinatorState(),
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const result = await completeStoredS3CoordinatorUpload({
      bucket: "media",
      client: {
        send(): Promise<HeadObjectCommandOutput> {
          throw new Error("unexpected s3 call");
        },
      },
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      objectKey: "media/other.m4s",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store,
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected rejected completion");
    }

    expect(result.error.error.code).toBe("olos.key_mismatch");
  });

  test("completes stored S3 uploads by object key", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const state = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/s3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKey: "media/s3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_3810",
      state: createEmptyCoordinatorState(),
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const result = await completeStoredS3CoordinatorUploadByObjectKey({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      objectKey: "media/s3810.m4s",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("committed");
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
  });

  test("rejects unknown object-key completions before querying S3", async () => {
    const store = createMemoryCoordinatorStore();
    await store.save({
      sessionId: session.sessionId,
      state: createEmptyCoordinatorState(),
    });

    const result = await completeStoredS3CoordinatorUploadByObjectKey({
      bucket: "media",
      client: {
        send(): Promise<HeadObjectCommandOutput> {
          throw new Error("unexpected s3 call");
        },
      },
      commitId: "commit_unknown",
      committedAt: "2026-01-01T00:00:02.000Z",
      objectKey: "media/unknown.m4s",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected rejected completion");
    }

    expect(result.error.error.code).toBe("olos.unknown_slot");
  });

  test("routes object-created events to object-key S3 completion", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const state = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/s3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKey: "media/s3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_3810",
      state: createEmptyCoordinatorState(),
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const result = await routeStoredS3CoordinatorUploadEvent({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
      event: normalizeUploadEvent({
        event: {
          contentType: "video/mp4",
          eventId: "evt_3810",
          eventTime: "2026-01-01T00:00:02.000Z",
          eventType: "object.created",
          objectKey: "media/s3810.m4s",
          providerId: "s3_primary",
          size: 98_304,
        },
      }),
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("committed");
    if (result.status !== "committed") {
      throw new Error("expected routed object-created commit");
    }

    expect(result.commit.commitId).toBe("evt_3810");
    expect(result.commit.committedAt).toBe("2026-01-01T00:00:02.000Z");
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
  });

  test("rejects object-created events blocked by commit policy", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const state = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/s3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKey: "media/s3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_3810",
      state: createEmptyCoordinatorState(),
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const result = await routeStoredS3CoordinatorUploadEvent({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
      commitPolicy: ({ slot }) => ({
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
      }),
      event: normalizeUploadEvent({
        event: {
          contentType: "video/mp4",
          eventId: "evt_3810",
          eventTime: "2026-01-01T00:00:02.000Z",
          eventType: "object.created",
          objectKey: "media/s3810.m4s",
          providerId: "s3_primary",
          size: 98_304,
        },
      }),
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store,
    });
    const snapshot = await store.load(session.sessionId);

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected commit policy rejection");
    }

    expect(result.error.error).toEqual({
      code: "olos.quota_exceeded",
      details: {
        publisherInstanceId: "pub_1",
      },
      message: "tenant quota exceeded",
    });
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
    expect(snapshot?.state.commits).toHaveLength(0);
    expect(snapshot?.state.slots[0]?.state).toBe("issued");
  });

  test("routes upload-completed hints to keyed S3 completion", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const state = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/s3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKey: "media/s3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_3810",
      state: createEmptyCoordinatorState(),
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const result = await routeStoredS3CoordinatorUploadEvent({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
      event: normalizeUploadEvent({
        event: {
          eventId: "hint_3810",
          eventTime: "2026-01-01T00:00:02.000Z",
          eventType: "upload.completed",
          objectKey: "media/s3810.m4s",
          slotId: "slot_3810",
        },
      }),
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("committed");
    if (result.status !== "committed") {
      throw new Error("expected routed upload-completed commit");
    }

    expect(result.commit.commitId).toBe("hint_3810");
    expect(result.commit.committedAt).toBe("2026-01-01T00:00:02.000Z");
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
  });

  test("rejects upload-completed hints while the kill switch is active", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const state = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/s3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKey: "media/s3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_3810",
      state: createEmptyCoordinatorState(),
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const result = await routeStoredS3CoordinatorUploadEvent({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
      event: normalizeUploadEvent({
        event: {
          eventId: "hint_3810",
          eventTime: "2026-01-01T00:00:02.000Z",
          eventType: "upload.completed",
          objectKey: "media/s3810.m4s",
          slotId: "slot_3810",
        },
      }),
      providerId: "s3_primary",
      publicationControl: createPublicationKillSwitch("incident"),
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected rejected upload-completed hint");
    }

    expect(result.error.error).toMatchObject({
      code: "olos.security_policy_violation",
      details: {
        operation: "commit_upload",
        reason: "incident",
      },
    });
    expect(headObjectInputs).toEqual([]);
  });

  test("ignores object-created events while the kill switch is active", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();
    const state = issueCoordinatorSlot({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/s3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKey: "media/s3810.m4s",
      publicationMode: "direct-public",
      publisherInstanceId: "pub_1",
      renditionId: "v1080",
      slotId: "slot_3810",
      state: createEmptyCoordinatorState(),
    }).state;
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const result = await routeStoredS3CoordinatorUploadEvent({
      bucket: "media",
      client: clientFor("media/s3810.m4s", 98_304, headObjectInputs),
      event: normalizeUploadEvent({
        event: {
          contentType: "video/mp4",
          eventId: "evt_3810",
          eventTime: "2026-01-01T00:00:02.000Z",
          eventType: "object.created",
          objectKey: "media/s3810.m4s",
          providerId: "s3_primary",
          size: 98_304,
        },
      }),
      providerId: "s3_primary",
      publicationControl: createPublicationKillSwitch("incident"),
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected ignored object-created event");
    }

    expect(result.error.error).toMatchObject({
      code: "olos.security_policy_violation",
      details: {
        operation: "process_provider_event",
        reason: "incident",
      },
    });
    expect(headObjectInputs).toEqual([]);
  });

  test("returns invalid upload events without querying S3", async () => {
    const result = await routeStoredS3CoordinatorUploadEvent({
      bucket: "media",
      client: {
        send(): Promise<HeadObjectCommandOutput> {
          throw new Error("unexpected s3 call");
        },
      },
      event: normalizeUploadEvent({ event: null }),
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store: createMemoryCoordinatorStore(),
    });

    expect(result.status).toBe("invalid_event");
    if (result.status !== "invalid_event") {
      throw new Error("expected invalid event");
    }

    expect(result.error.error.code).toBe("olos.invalid_state");
  });

  test("does not query S3 for missing stored coordinator sessions", async () => {
    const result = await commitStoredS3CoordinatorUpload({
      bucket: "media",
      client: {
        send(): Promise<HeadObjectCommandOutput> {
          throw new Error("unexpected s3 call");
        },
      },
      commitId: "commit_missing",
      committedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotId: "slot_3810",
      store: createMemoryCoordinatorStore(),
    });

    expect(result).toEqual({ status: "not_found" });
  });

  test("does not query S3 for unknown slots", async () => {
    const state = createEmptyCoordinatorState();
    const result = await commitS3CoordinatorUpload({
      bucket: "media",
      client: {
        send(): Promise<HeadObjectCommandOutput> {
          throw new Error("unexpected s3 call");
        },
      },
      commitId: "commit_unknown",
      committedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      slotId: "slot_unknown",
      state,
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected rejected upload");
    }

    expect(result.error.error.code).toBe("olos.unknown_slot");
  });
});

async function createCommitConflictingStore(): Promise<CoordinatorPipelineStore> {
  const store = createMemoryCoordinatorStore();
  const originalSave = store.save;
  const ready = createCoordinatorStateWithIssuedSegment();
  let conflicted = false;

  await store.save({
    sessionId: session.sessionId,
    state: ready,
  });

  return {
    load: store.load,
    save: async (options) => {
      if (!conflicted) {
        conflicted = true;
        const current = await store.load(session.sessionId);

        if (current === undefined) {
          throw new Error("expected ready coordinator snapshot");
        }

        const next = issueCoordinatorSlot({
          ...segmentSlot(),
          deliveryUrl: "https://media.example.com/s3811.m4s",
          mediaSequenceNumber: 3811,
          objectKey: "media/s3811.m4s",
          slotId: "slot_3811",
          state: current.state,
        });
        const saved = await originalSave({
          expectedEtag: current.etag,
          sessionId: session.sessionId,
          state: next.state,
        });

        if (saved.status !== "saved") {
          throw new Error("expected external coordinator save");
        }

        return {
          current: {
            etag: saved.etag,
            state: saved.state,
          },
          status: "conflict",
        };
      }

      return await originalSave(options);
    },
  };
}

function segmentSlot() {
  return {
    contentType: "video/mp4",
    deliveryUrl: "https://media.example.com/s3810.m4s",
    duration: 2,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: "segment" as const,
    maxBytes: 100_000,
    mediaSequenceNumber: 3810,
    objectKey: "media/s3810.m4s",
    publicationMode: "direct-public" as const,
    publisherInstanceId: "pub_1",
    renditionId: "v1080",
    slotId: "slot_3810",
  };
}

function clientFor(
  objectKey: string,
  size: number,
  inputs: unknown[],
  contentType = "video/mp4",
  metadata?: Record<string, string>
): S3HeadObjectClient {
  return {
    send(command: HeadObjectCommand): Promise<HeadObjectCommandOutput> {
      inputs.push(command.input);

      return Promise.resolve({
        $metadata: {},
        ContentLength: size,
        ContentType: contentType,
        ETag: `"${objectKey}"`,
        LastModified: new Date("2026-01-01T00:00:01.000Z"),
        ...(metadata === undefined ? {} : { Metadata: metadata }),
      });
    },
  };
}
