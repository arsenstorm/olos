import { renderMediaPlaylist } from "@arsenstorm/olos/hls";
import {
  createDirectPublicMediaSecurityPolicy,
  createRuntimeObjectLowLatencyManifestOptions,
  createRuntimeObjectLowLatencyProfile,
} from "@arsenstorm/olos/media";
import {
  commitObservedUpload,
  createCommit,
  createCommittedWindow,
  createCursor,
  createObjectPublication,
  createObservedUpload,
} from "@arsenstorm/olos/state";
import type {
  ProviderCapabilityDocument,
  StorageObject,
  UploadSlot,
} from "@arsenstorm/olos/types";
import {
  assertCommittedWindow,
  assertCursor,
} from "@arsenstorm/olos/validation";
import { describe, expect, test } from "vitest";
import { createTestSession } from "./protocol-fixtures";

const session = createTestSession();
const latency = createRuntimeObjectLowLatencyProfile();
const manifestOptions = createRuntimeObjectLowLatencyManifestOptions(latency);

const slot: UploadSlot = {
  contentType: "video/mp4",
  deliveryUrl: "/media/v1080/s3810.m4s",
  epoch: 1,
  expiresAt: "2026-01-01T00:00:05.000Z",
  kind: "segment",
  maxBytes: 100_000,
  sequenceNumber: 3810,
  objectKey: "media/v1080/s3810.m4s",
  profile: { duration: 2 },
  trackId: "v1080",
  sessionId: "session_1",
  slotId: "slot_3810",
  state: "upload_observed",
};

const mediaObject: StorageObject = createObservedUpload({
  contentType: "video/mp4",
  objectKey: "media/v1080/s3810.m4s",
  observedAt: "2026-01-01T00:00:01.000Z",
  providerId: "r2_primary",
  size: 98_304,
});

const directPublicCapability: ProviderCapabilityDocument = {
  consistency: {
    headAfterCreate: "strong",
    readAfterCreate: "strong",
  },
  delivery: {
    documentNavigationCanBeBlocked: true,
    immutableCaching: true,
    negativeCachingPolicyDeclared: true,
    publicBaseUrl: "https://media.example.com",
  },
  kind: "object-store",
  olos: "1.0",
  providerId: "r2_primary",
  publication: {
    createIfAbsent: true,
    directObjectPublication: true,
    manifestGatedPublication: true,
    overwritesAllowed: false,
  },
  uploadGrants: {
    contentTypeBound: true,
    exactKey: true,
    methodBound: true,
    objectSizeCanBeObserved: true,
    presignedPut: true,
    requiredHeadersCanBeSigned: true,
  },
};

describe("protocol flow", () => {
  test("publishes an observed upload through cursor and HLS output", () => {
    const initCommit = createCommit({
      commitId: "commit_init",
      committedAt: "2026-01-01T00:00:01.000Z",
      mediaObject: {
        ...mediaObject,
        objectKey: "media/v1080/init.mp4",
        size: 1024,
      },
      slot: {
        ...slot,
        deliveryUrl: "/media/v1080/init.mp4",
        kind: "init",
        maxBytes: 2048,
        sequenceNumber: 0,
        objectKey: "media/v1080/init.mp4",
        profile: { duration: 1 },
        slotId: "slot_init",
      },
    });

    const { commit: mediaCommit } = commitObservedUpload({
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      object: mediaObject,
      profile: {
        independent: true,
        programDateTime: "2026-01-01T00:00:00.000Z",
      },
      slot: { ...slot, state: "issued" },
    });

    const committedWindow = createCommittedWindow({
      commits: [mediaCommit],
      epoch: 1,
      initCommits: [initCommit],
      sessionId: "session_1",
    });

    assertCommittedWindow(committedWindow);

    const cursor = createCursor({
      committedWindow,
      deliveryBaseUrl: "https://media.example.com",
      profile: session.profile,
      sessionId: "session_1",
      state: "live",
      updatedAt: "2026-01-01T00:00:02.000Z",
    });

    assertCursor(cursor);

    const playlist = renderMediaPlaylist(committedWindow, {
      ...manifestOptions.manifest,
      trackId: "v1080",
    });

    expect(cursor.window).toEqual({
      firstSequenceNumber: 3810,
      lastSequenceNumber: 3810,
    });
    expect(playlist).toContain("#EXT-X-MEDIA-SEQUENCE:3810");
    expect(playlist).toContain('#EXT-X-MAP:URI="/media/v1080/init.mp4"');
    expect(playlist).toContain("#EXTINF:2.000,");
    expect(playlist).toContain("/media/v1080/s3810.m4s");
  });

  test("publishes direct-public objects through security policy and HLS output", () => {
    const directPublicSlot = {
      ...slot,
      deliveryUrl: "https://media.example.com/media/v1080/s3810.m4s",
    };
    const initSlot = {
      ...directPublicSlot,
      deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
      kind: "init" as const,
      maxBytes: 2048,
      sequenceNumber: 0,
      objectKey: "media/v1080/init.mp4",
      profile: { duration: 1 },
      slotId: "slot_init",
    };

    const initCommit = createCommit({
      commitId: "commit_init",
      committedAt: "2026-01-01T00:00:01.000Z",
      mediaObject: {
        ...mediaObject,
        objectKey: "media/v1080/init.mp4",
        size: 1024,
      },
      slot: initSlot,
    });

    const { commit: mediaCommit } = commitObservedUpload({
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      profile: { independent: true },
      object: mediaObject,
      slot: { ...directPublicSlot, state: "issued" },
    });

    const initPublication = createObjectPublication({
      capability: directPublicCapability,
      commit: initCommit,
    });
    const mediaPublication = createObjectPublication({
      capability: directPublicCapability,
      commit: mediaCommit,
    });
    const securityPolicy = createDirectPublicMediaSecurityPolicy({
      capability: directPublicCapability,
      manifestMaxAgeSeconds: 2,
      targetLatencySeconds: manifestOptions.response.targetLatencySeconds,
    });

    const committedWindow = createCommittedWindow({
      commits: [mediaCommit],
      epoch: 1,
      initCommits: [initCommit],
      sessionId: "session_1",
    });

    const playlist = renderMediaPlaylist(committedWindow, {
      allowedDeliveryOrigins: securityPolicy.allowedDeliveryOrigins,
      ...manifestOptions.manifest,
      trackId: "v1080",
    });

    expect(initPublication.deliveryUrl).toBe(initCommit.deliveryUrl);
    expect(mediaPublication.deliveryUrl).toBe(mediaCommit.deliveryUrl);
    expect(securityPolicy.manifestCachePolicy.maxAgeSeconds).toBe(2);
    expect(securityPolicy.mediaObjectCachePolicy.cacheControl).toContain(
      "immutable"
    );
    expect(playlist).toContain(
      '#EXT-X-MAP:URI="https://media.example.com/media/v1080/init.mp4"'
    );
    expect(playlist).toContain(
      "https://media.example.com/media/v1080/s3810.m4s"
    );
  });
});
