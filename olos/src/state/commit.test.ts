import { describe, expect, test } from "bun:test";
import type { Cursor } from "../types/cursor";
import type { MediaObject } from "../types/media-object";
import type { Session } from "../types/session";
import type { UploadSlot } from "../types/upload-slot";
import type { ObservedUpload } from "../validation/observed-upload";
import {
  commitObservedUpload,
  createCommit,
  resolveCommitAttempt,
  resolveDuplicateCommit,
  resolveObjectSlotMismatch,
  resolveUploadCommit,
} from "./commit";

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

const observedUpload: ObservedUpload = {
  ...mediaObject,
  metadata: {
    "x-olos-slot-id": "slot_1",
  },
};

const session: Session = {
  createdAt: "2026-01-01T00:00:00.000Z",
  epoch: 0,
  latencyProfile: "object-ll",
  olos: "1.0",
  partTarget: 0.5,
  renditions: [
    {
      codec: "avc1.640028",
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

const cursor: Cursor = {
  committedWindow: {
    discontinuitySequence: 0,
    epoch: 0,
    firstMediaSequenceNumber: 3810,
    lastMediaSequenceNumber: 3811,
    renditions: {
      v1080: {
        init: {
          commitId: "commit_init",
          deliveryUrl: "/objects/tenant/session/v1080/init.mp4",
          objectKey: "tenant/session/v1080/init.mp4",
          slotId: "slot_init",
        },
        renditionId: "v1080",
        segments: [
          {
            duration: 2,
            mediaSequenceNumber: 3811,
            parts: [
              {
                commitId: "commit_3811_0",
                deliveryUrl: "/objects/tenant/session/v1080/3811.0.m4s",
                duration: 0.5,
                objectKey: "tenant/session/v1080/3811.0.m4s",
                partNumber: 0,
                slotId: "slot_3811_0",
              },
            ],
          },
        ],
      },
    },
  },
  epoch: 0,
  latencyProfile: "object-ll",
  olos: "1.0",
  mediaBaseUrl: "https://media.example.com",
  partTarget: 0.5,
  segmentTarget: 2,
  sessionId: "session_1",
  state: "live",
  tenantId: "tenant_1",
  updatedAt: "2026-01-01T00:00:03.000Z",
  window: {
    firstMediaSequenceNumber: 3810,
    lastMediaSequenceNumber: 3811,
    lastPartNumber: 0,
  },
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

  test("allows commits within configured late tolerance", () => {
    expect(
      createCommit({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:05.500Z",
        lateToleranceMs: 1000,
        mediaObject,
        slot,
      }).commitId
    ).toBe("commit_1");
  });

  test("allows commits exactly at slot expiration", () => {
    expect(
      createCommit({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:05.000Z",
        mediaObject,
        slot,
      }).commitId
    ).toBe("commit_1");
  });

  test("rejects invalid late tolerance", () => {
    expect(() =>
      createCommit({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:05.500Z",
        lateToleranceMs: -1,
        mediaObject,
        slot,
      })
    ).toThrow("lateToleranceMs must be a non-negative number");
  });
});

describe("upload commit resolution", () => {
  test("creates a commit and marks the slot as committed", () => {
    expect(
      resolveUploadCommit({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        mediaObject,
        slot,
      })
    ).toEqual({
      commit: {
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        deliveryUrl: "/objects/tenant/session/v1080/3810.m4s",
        duration: 2,
        epoch: 0,
        etag: '"abc123"',
        mediaSequenceNumber: 3810,
        objectKey: "tenant/session/v1080/3810.m4s",
        renditionId: "v1080",
        sessionId: "session_1",
        size: 98_304,
        slotId: "slot_1",
      },
      slot: {
        ...slot,
        state: "committed",
      },
    });
  });
});

describe("commit attempt resolution", () => {
  test("returns an unknown slot error when the slot lookup misses", () => {
    expect(
      resolveCommitAttempt({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        mediaObject,
        slotId: "slot_missing",
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.unknown_slot",
          details: {
            slotId: "slot_missing",
          },
          message: "upload slot is unknown",
        },
      },
      status: "unknown_slot",
    });
  });

  test("commits when the slot lookup succeeds", () => {
    expect(
      resolveCommitAttempt({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        mediaObject,
        objectVerified: true,
        session,
        slot,
        slotId: "slot_1",
      }).status
    ).toBe("committed");
  });

  test("returns an invalid state error after session abort", () => {
    expect(
      resolveCommitAttempt({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        mediaObject,
        session: { ...session, state: "aborted" },
        slot,
        slotId: "slot_1",
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.invalid_state",
          details: {
            sessionId: "session_1",
            slotId: "slot_1",
            state: "aborted",
          },
          message: "session is aborted",
        },
      },
      status: "invalid_state",
    });
  });

  test("keeps the slot uncommitted without object proof", () => {
    expect(
      resolveCommitAttempt({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        mediaObject,
        session,
        slot,
        slotId: "slot_1",
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.invalid_state",
          details: {
            objectKey: "tenant/session/v1080/3810.m4s",
            slotId: "slot_1",
          },
          message: "object existence is unverified",
        },
      },
      status: "unverified_object",
    });
  });

  test("returns a key mismatch error for a different object key", () => {
    expect(
      resolveCommitAttempt({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        mediaObject: { ...mediaObject, objectKey: "other.m4s" },
        objectVerified: true,
        slot,
        slotId: "slot_1",
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.key_mismatch",
          details: {
            objectKey: "other.m4s",
            slotId: "slot_1",
            slotObjectKey: "tenant/session/v1080/3810.m4s",
          },
          message: "object key does not match slot",
        },
      },
      status: "key_mismatch",
    });
  });

  test("returns a content type mismatch error", () => {
    expect(
      resolveCommitAttempt({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        mediaObject: {
          ...mediaObject,
          contentType: "application/octet-stream",
        },
        objectVerified: true,
        slot,
        slotId: "slot_1",
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.content_type_mismatch",
          details: {
            contentType: "application/octet-stream",
            objectKey: "tenant/session/v1080/3810.m4s",
            slotContentType: "video/mp4",
            slotId: "slot_1",
          },
          message: "object content type does not match slot",
        },
      },
      status: "content_type_mismatch",
    });
  });

  test("shares object-slot mismatch checks without forcing key validation", () => {
    expect(
      resolveObjectSlotMismatch({
        mediaObject: { ...mediaObject, objectKey: "other.m4s" },
        slot,
      })
    ).toBeUndefined();
    expect(
      resolveObjectSlotMismatch({
        includeKeyMismatch: true,
        mediaObject: { ...mediaObject, objectKey: "other.m4s" },
        slot,
      })?.status
    ).toBe("key_mismatch");
  });

  test("returns direct object-slot mismatch details for undersized objects", () => {
    expect(
      resolveObjectSlotMismatch({
        mediaObject: { ...mediaObject, size: 50 },
        slot: { ...slot, minBytes: 100_000 },
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.object_too_small",
          details: {
            minBytes: 100_000,
            objectKey: "tenant/session/v1080/3810.m4s",
            size: 50,
            slotId: "slot_1",
          },
          message: "mediaObject.size must be at least minBytes",
        },
      },
      status: "object_too_small",
    });
  });

  test("returns an object too large error for oversized objects", () => {
    expect(
      resolveCommitAttempt({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        mediaObject: { ...mediaObject, size: 100_001 },
        objectVerified: true,
        slot,
        slotId: "slot_1",
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.object_too_large",
          details: {
            maxBytes: 100_000,
            objectKey: "tenant/session/v1080/3810.m4s",
            size: 100_001,
            slotId: "slot_1",
          },
          message: "object exceeds slot limit",
        },
      },
      status: "object_too_large",
    });
  });

  test("returns an object too small error for undersized objects", () => {
    expect(
      resolveCommitAttempt({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        mediaObject: { ...mediaObject, size: 50 },
        objectVerified: true,
        slot: { ...slot, minBytes: 100_000 },
        slotId: "slot_1",
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.object_too_small",
          details: {
            minBytes: 100_000,
            objectKey: "tenant/session/v1080/3810.m4s",
            size: 50,
            slotId: "slot_1",
          },
          message: "mediaObject.size must be at least minBytes",
        },
      },
      status: "object_too_small",
    });
  });

  test("rejects objects behind the current cursor", () => {
    expect(
      resolveCommitAttempt({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        cursor,
        mediaObject,
        objectVerified: true,
        slot,
        slotId: "slot_1",
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.invalid_state",
          details: {
            cursorLastMediaSequenceNumber: 3811,
            cursorLastPartNumber: 0,
            mediaSequenceNumber: 3810,
            partNumber: undefined,
            slotId: "slot_1",
          },
          message: "object is behind the current cursor",
        },
      },
      status: "late_object",
    });
  });

  test("returns late object errors before object-slot mismatch errors", () => {
    expect(
      resolveCommitAttempt({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        cursor,
        mediaObject: { ...mediaObject, objectKey: "other.m4s" },
        objectVerified: true,
        slot,
        slotId: "slot_1",
      }).status
    ).toBe("late_object");
  });

  test("allows full segments at the current cursor media sequence", () => {
    const currentSegmentSlot = {
      ...slot,
      deliveryUrl: "/objects/tenant/session/v1080/3811.m4s",
      mediaSequenceNumber: 3811,
      objectKey: "tenant/session/v1080/3811.m4s",
      slotId: "slot_3811",
    };

    expect(
      resolveCommitAttempt({
        commitId: "commit_3811",
        committedAt: "2026-01-01T00:00:02.000Z",
        cursor,
        mediaObject: {
          ...mediaObject,
          objectKey: "tenant/session/v1080/3811.m4s",
        },
        objectVerified: true,
        slot: currentSegmentSlot,
        slotId: "slot_3811",
      }).status
    ).toBe("committed");
  });

  test("rejects parts already published by the current cursor", () => {
    const partSlot = {
      ...slot,
      deliveryUrl: "/objects/tenant/session/v1080/3811.0.m4s",
      duration: 0.5,
      mediaSequenceNumber: 3811,
      objectKey: "tenant/session/v1080/3811.0.m4s",
      partNumber: 0,
      slotId: "slot_3811_0",
    };

    expect(
      resolveCommitAttempt({
        commitId: "commit_3811_0",
        committedAt: "2026-01-01T00:00:02.000Z",
        cursor,
        mediaObject: {
          ...mediaObject,
          objectKey: "tenant/session/v1080/3811.0.m4s",
        },
        objectVerified: true,
        slot: partSlot,
        slotId: "slot_3811_0",
      }).status
    ).toBe("late_object");
  });
});

describe("observed upload commit builder", () => {
  test("observes an issued slot and creates a commit", () => {
    expect(
      commitObservedUpload({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        independent: true,
        object: observedUpload,
        programDateTime: "2026-01-01T00:00:00.000Z",
        slot: { ...slot, state: "issued" },
      })
    ).toEqual({
      commit: {
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
        renditionId: "v1080",
        sessionId: "session_1",
        size: 98_304,
        slotId: "slot_1",
      },
      slot: {
        ...slot,
        state: "committed",
      },
    });
  });

  test("commits already observed slots idempotently", () => {
    expect(
      commitObservedUpload({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        object: observedUpload,
        slot,
      }).slot
    ).toEqual({
      ...slot,
      state: "committed",
    });
  });

  test("rejects invalid observations", () => {
    expect(() =>
      commitObservedUpload({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        object: { ...observedUpload, objectKey: "other.m4s" },
        slot: { ...slot, state: "issued" },
      })
    ).toThrow("observedUpload.objectKey must match uploadSlot.objectKey");
  });
});

describe("duplicate commit resolution", () => {
  const existingCommit = createCommit({
    commitId: "commit_1",
    committedAt: "2026-01-01T00:00:02.000Z",
    mediaObject,
    slot,
  });

  test("keeps the existing commit for idempotent duplicates", () => {
    const candidateCommit = {
      ...existingCommit,
      commitId: "commit_retry",
      committedAt: "2026-01-01T00:00:03.000Z",
    };

    expect(
      resolveDuplicateCommit({
        candidateCommit,
        existingCommit,
      })
    ).toEqual({
      commit: existingCommit,
      status: "idempotent",
    });
  });

  test("returns a duplicate commit conflict for different object evidence", () => {
    expect(
      resolveDuplicateCommit({
        candidateCommit: {
          ...existingCommit,
          commitId: "commit_retry",
          etag: '"different"',
        },
        existingCommit,
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.duplicate_commit_conflict",
          details: {
            candidateCommitId: "commit_retry",
            existingCommitId: "commit_1",
            slotId: "slot_1",
          },
          message: "duplicate commit conflicts with the existing commit",
        },
      },
      status: "conflict",
    });
  });
});
