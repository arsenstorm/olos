import { renderMediaPlaylist } from "@arsenstorm/olos/hls";
import {
  createRuntimeObjectLowLatencyManifestOptions,
  createRuntimeObjectLowLatencyProfile,
} from "@arsenstorm/olos/runtime";
import {
  commitObservedUpload,
  createCommit,
  createCommittedWindow,
  createCursor,
  createDirectPublicSecurityPolicy,
  createObjectPublication,
  createObservedUpload,
} from "@arsenstorm/olos/state";
import type {
  MediaObject,
  ProviderCapabilityDocument,
  UploadSlot,
} from "@arsenstorm/olos/types";
import {
  assertCommittedWindow,
  assertCursor,
} from "@arsenstorm/olos/validation";
import { describe, expect, test } from "vitest";

const latency = createRuntimeObjectLowLatencyProfile();
const manifestOptions = createRuntimeObjectLowLatencyManifestOptions(latency);

const slot: UploadSlot = {
  contentType: "video/mp4",
  deliveryUrl: "/media/v1080/3810.m4s",
  duration: 2,
  epoch: 1,
  expiresAt: "2026-01-01T00:00:05.000Z",
  kind: "segment",
  maxBytes: 100_000,
  mediaSequenceNumber: 3810,
  objectKey: "media/v1080/3810.m4s",
  publicationMode: "direct-public",
  publisherInstanceId: "pub_1",
  renditionId: "v1080",
  sessionId: "session_1",
  slotId: "slot_3810",
  state: "upload_observed",
  tenantId: "tenant_1",
};

const mediaObject: MediaObject = createObservedUpload({
  contentType: "video/mp4",
  objectKey: "media/v1080/3810.m4s",
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
        duration: 1,
        kind: "init",
        maxBytes: 2048,
        mediaSequenceNumber: 0,
        objectKey: "media/v1080/init.mp4",
        slotId: "slot_init",
      },
    });

    const { commit: mediaCommit } = commitObservedUpload({
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: true,
      object: mediaObject,
      programDateTime: "2026-01-01T00:00:00.000Z",
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
      latencyProfile: latency.latencyProfile,
      mediaBaseUrl: "https://media.example.com",
      partTarget: latency.partTarget,
      segmentTarget: latency.segmentTarget,
      sessionId: "session_1",
      state: "live",
      tenantId: "tenant_1",
      updatedAt: "2026-01-01T00:00:02.000Z",
    });

    assertCursor(cursor);

    const playlist = renderMediaPlaylist(committedWindow, {
      ...manifestOptions.manifest,
      renditionId: "v1080",
    });

    expect(cursor.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(playlist).toContain("#EXT-X-MEDIA-SEQUENCE:3810");
    expect(playlist).toContain('#EXT-X-MAP:URI="/media/v1080/init.mp4"');
    expect(playlist).toContain("#EXTINF:2.000,");
    expect(playlist).toContain("/media/v1080/3810.m4s");
  });

  test("publishes direct-public objects through security policy and HLS output", () => {
    const directPublicSlot = {
      ...slot,
      deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
    };
    const initSlot = {
      ...directPublicSlot,
      deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
      duration: 1,
      kind: "init" as const,
      maxBytes: 2048,
      mediaSequenceNumber: 0,
      objectKey: "media/v1080/init.mp4",
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
      independent: true,
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
    const securityPolicy = createDirectPublicSecurityPolicy({
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
      allowedMediaOrigins: securityPolicy.allowedMediaOrigins,
      ...manifestOptions.manifest,
      renditionId: "v1080",
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
      "https://media.example.com/media/v1080/3810.m4s"
    );
  });
});
