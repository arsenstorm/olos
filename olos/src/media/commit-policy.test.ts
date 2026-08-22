import { describe, expect, test } from "bun:test";
import type { CoordinatorPipelineState } from "../protocol/coordinator-types";
import { mergeProfileData } from "../state/profile-data";
import type { Session } from "../types/session";
import type { UploadSlot } from "../types/upload-slot";
import type { ObservedUpload } from "../validation/observed-upload";
import { mediaCommitPolicy } from "./commit-policy";
import { CMAF_LLHLS_PROFILE_ID } from "./types";

const mediaSession: Session = {
  createdAt: "2026-01-01T00:00:00.000Z",
  epoch: 1,
  olos: "1.0",
  profile: { id: CMAF_LLHLS_PROFILE_ID, partTarget: 0.5, segmentTarget: 2 },
  sessionId: "session_1",
  state: "live",
  tracks: [],
};

const mediaState: CoordinatorPipelineState = {
  commits: [],
  deliveryBaseUrl: "https://media.example.com",
  initCommits: [],
  publisherLeases: [],
  session: mediaSession,
  slots: [],
};

const baseSlot: UploadSlot = {
  contentType: "video/mp4",
  deliveryUrl: "https://media.example.com/objects/v1080/s0.m4s",
  epoch: 1,
  expiresAt: "2026-01-01T00:00:05.000Z",
  kind: "segment",
  maxBytes: 100_000,
  objectKey: "objects/v1080/s0.m4s",
  sequenceNumber: 0,
  sessionId: "session_1",
  slotId: "slot_1",
  state: "upload_observed",
  trackId: "v1080",
};

const object: ObservedUpload = {
  contentType: "video/mp4",
  objectKey: "objects/v1080/s0.m4s",
  observedAt: "2026-01-01T00:00:02.000Z",
  providerId: "s3_primary",
  size: 1000,
};

describe("mediaCommitPolicy", () => {
  test("allows init object commits", () => {
    expect(
      mediaCommitPolicy({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        object,
        slot: {
          ...baseSlot,
          deliveryUrl: "https://media.example.com/objects/v1080/init.mp4",
          kind: "init",
          objectKey: "objects/v1080/init.mp4",
        },
        state: mediaState,
      })
    ).toEqual({ status: "allowed" });
  });

  test("allows commits for sessions running another profile", () => {
    expect(
      mediaCommitPolicy({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        object,
        slot: baseSlot,
        state: {
          ...mediaState,
          session: { ...mediaSession, profile: { id: "other-profile" } },
        },
      })
    ).toEqual({ status: "allowed" });
  });

  test("rejects a part commit without a duration", () => {
    const result = mediaCommitPolicy({
      commitId: "commit_1",
      committedAt: "2026-01-01T00:00:02.000Z",
      object,
      profile: {},
      slot: { ...baseSlot, kind: "part", partNumber: 0 },
      state: mediaState,
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected rejected policy decision");
    }
    expect(result.error.error.code).toBe("olos.invalid_request");
    expect(result.error.error.details).toEqual({ slotId: "slot_1" });
  });

  test("allows a part commit with a positive duration", () => {
    expect(
      mediaCommitPolicy({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        object,
        profile: { duration: 0.5 },
        slot: { ...baseSlot, kind: "part", partNumber: 0 },
        state: mediaState,
      })
    ).toEqual({ status: "allowed" });
  });

  test("rejects a segment commit whose object key uses an unsupported extension", () => {
    const result = mediaCommitPolicy({
      commitId: "commit_1",
      committedAt: "2026-01-01T00:00:02.000Z",
      object,
      profile: { duration: 0.5 },
      slot: { ...baseSlot, objectKey: "objects/v1080/s0.txt" },
      state: mediaState,
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected rejected policy decision");
    }
    expect(result.error.error.code).toBe("olos.invalid_request");
  });

  test("allows a duration inherited from the slot's own profile", () => {
    const slot: UploadSlot = { ...baseSlot, profile: { duration: 0.5 } };

    expect(
      mediaCommitPolicy({
        commitId: "commit_1",
        committedAt: "2026-01-01T00:00:02.000Z",
        object,
        profile: mergeProfileData(slot.profile, { independent: true }),
        slot,
        state: mediaState,
      })
    ).toEqual({ status: "allowed" });
  });
});
