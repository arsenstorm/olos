import { renderMediaPlaylist } from "olos/hls";
import {
  commitObservedUpload,
  createCommit,
  createCommittedWindow,
  createCursor,
  createObservedUpload,
} from "olos/state";
import type { MediaObject, UploadSlot } from "olos/types";
import { assertCommittedWindow, assertCursor } from "olos/validation";
import { describe, expect, test } from "vitest";

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
      latencyProfile: "object-ll",
      partTarget: 0.5,
      pathways: [
        {
          baseUrl: "https://media.example.com",
          pathwayId: "primary",
          priority: 0,
          providerId: "r2_primary",
          state: "active",
        },
      ],
      segmentTarget: 2,
      sessionId: "session_1",
      state: "live",
      tenantId: "tenant_1",
      updatedAt: "2026-01-01T00:00:02.000Z",
    });

    assertCursor(cursor);

    const playlist = renderMediaPlaylist(committedWindow, {
      partTarget: 0.5,
      renditionId: "v1080",
      segmentTarget: 2,
      targetLatency: 3,
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
});
