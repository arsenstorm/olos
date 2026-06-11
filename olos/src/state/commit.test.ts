import { describe, expect, test } from "bun:test";
import type { MediaObject } from "../types/media-object";
import type { UploadSlot } from "../types/upload-slot";
import { createCommit } from "./commit";

const slot: UploadSlot = {
  contentType: "video/mp4",
  deliveryUrl: "/objects/tenant/session/v1080/3810.m4s",
  duration: 2,
  epoch: 0,
  expiresAt: "2026-01-01T00:00:05.000Z",
  kind: "segment",
  maxBytes: 100_000,
  mediaSequenceNumber: 3810,
  minBytes: 1,
  objectKey: "tenant/session/v1080/3810.m4s",
  publicationMode: "direct-public",
  publisherInstanceId: "pub_1",
  renditionId: "v1080",
  sessionId: "session_1",
  slotId: "slot_1",
  state: "upload_observed",
  tenantId: "tenant_1",
};

const mediaObject: MediaObject = {
  contentType: "video/mp4",
  etag: '"abc123"',
  objectKey: "tenant/session/v1080/3810.m4s",
  observedAt: "2026-01-01T00:00:01.000Z",
  providerId: "r2_primary",
  size: 98_304,
};

describe("commit builder", () => {
  test("creates a commit from an observed upload slot", () => {
    expect(
      createCommit({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        independent: true,
        mediaObject,
        programDateTime: "2026-01-01T00:00:00.000Z",
        slot,
      })
    ).toEqual({
      commitId: "commit_1",
      committedAt: "2026-01-01T00:00:02.000Z",
      deliveryUrl: "/objects/tenant/session/v1080/3810.m4s",
      duration: 2,
      epoch: 0,
      etag: '"abc123"',
      independent: true,
      mediaSequenceNumber: 3810,
      objectKey: "tenant/session/v1080/3810.m4s",
      programDateTime: "2026-01-01T00:00:00.000Z",
      providerId: "r2_primary",
      publicationMode: "direct-public",
      renditionId: "v1080",
      sessionId: "session_1",
      size: 98_304,
      slotId: "slot_1",
    });
  });

  test("includes part numbers for part commits", () => {
    const commit = createCommit({
      commitId: "commit_1",
      committedAt: "2026-01-01T00:00:02.000Z",
      mediaObject,
      slot: { ...slot, partNumber: 3 },
    });

    expect(commit.partNumber).toBe(3);
  });

  test("rejects slots that are not upload-observed", () => {
    expect(() =>
      createCommit({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        mediaObject,
        slot: { ...slot, state: "issued" },
      })
    ).toThrow("uploadSlot.state must be upload_observed");
  });

  test("rejects object key mismatches", () => {
    expect(() =>
      createCommit({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        mediaObject: { ...mediaObject, objectKey: "other.m4s" },
        slot,
      })
    ).toThrow("mediaObject.objectKey must match uploadSlot.objectKey");
  });

  test("rejects content type mismatches", () => {
    expect(() =>
      createCommit({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        mediaObject: {
          ...mediaObject,
          contentType: "application/octet-stream",
        },
        slot,
      })
    ).toThrow("mediaObject.contentType must match uploadSlot.contentType");
  });

  test("rejects objects larger than the slot byte limit", () => {
    expect(() =>
      createCommit({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        mediaObject: { ...mediaObject, size: 100_001 },
        slot,
      })
    ).toThrow("mediaObject.size must be less than or equal to maxBytes");
  });

  test("rejects objects smaller than the slot byte limit", () => {
    expect(() =>
      createCommit({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        mediaObject: { ...mediaObject, size: 1 },
        slot: { ...slot, minBytes: 2 },
      })
    ).toThrow("mediaObject.size must be greater than or equal to minBytes");
  });

  test("rejects expired commits", () => {
    expect(() =>
      createCommit({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:06.000Z",
        mediaObject,
        slot,
      })
    ).toThrow("commit.committedAt must be before uploadSlot.expiresAt");
  });
});
