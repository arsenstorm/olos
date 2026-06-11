import { describe, expect, test } from "bun:test";
import type { Session } from "../types/session";
import type { UploadSlot } from "../types/upload-slot";
import type { ObservedUpload } from "../validation/observed-upload";

import {
  assertUploadSlotTransition,
  canTransitionUploadSlot,
  createIssuedUploadSlot,
  observeUpload,
} from "./upload-slot";

const session: Session = {
  createdAt: "2026-01-01T00:00:00.000Z",
  epoch: 0,
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

const slot: UploadSlot = {
  contentType: "video/mp4",
  deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
  duration: 2,
  epoch: 0,
  expiresAt: "2026-01-01T00:00:05.000Z",
  kind: "segment",
  maxBytes: 100_000,
  mediaSequenceNumber: 3810,
  minBytes: 1000,
  objectKey: "live/session/v1080/3810.m4s",
  publicationMode: "direct-public",
  publisherInstanceId: "pub_1",
  renditionId: "v1080",
  sessionId: "session_1",
  slotId: "slot_1",
  state: "issued",
  tenantId: "tenant_1",
};

const object: ObservedUpload = {
  contentType: "video/mp4",
  etag: "abc123",
  metadata: {
    "x-olos-slot-id": "slot_1",
  },
  objectKey: "live/session/v1080/3810.m4s",
  observedAt: "2026-01-01T00:00:03.000Z",
  providerId: "s3_primary",
  size: 50_000,
};

describe("upload slot issuance", () => {
  test("creates an issued slot for a live session", () => {
    expect(
      createIssuedUploadSlot({
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
        duration: 2,
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "segment",
        maxBytes: 100_000,
        mediaSequenceNumber: 3810,
        minBytes: 1000,
        objectKey: "live/session/v1080/3810.m4s",
        publicationMode: "direct-public",
        publisherInstanceId: "pub_1",
        renditionId: "v1080",
        session,
        slotId: "slot_1",
      })
    ).toEqual(slot);
  });

  test("rejects non-live sessions", () => {
    expect(() =>
      createIssuedUploadSlot({
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
        duration: 2,
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "segment",
        maxBytes: 100_000,
        mediaSequenceNumber: 3810,
        objectKey: "live/session/v1080/3810.m4s",
        publicationMode: "direct-public",
        publisherInstanceId: "pub_1",
        renditionId: "v1080",
        session: { ...session, state: "created" },
        slotId: "slot_1",
      })
    ).toThrow("session.state must be live");
  });

  test("rejects renditions outside the session", () => {
    expect(() =>
      createIssuedUploadSlot({
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/live/session/v720/3810.m4s",
        duration: 2,
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "segment",
        maxBytes: 100_000,
        mediaSequenceNumber: 3810,
        objectKey: "live/session/v720/3810.m4s",
        publicationMode: "direct-public",
        publisherInstanceId: "pub_1",
        renditionId: "v720",
        session,
        slotId: "slot_1",
      })
    ).toThrow("uploadSlot.renditionId must belong to session.renditions");
  });
});

describe("upload slot transitions", () => {
  test("allows spec-defined transitions", () => {
    expect(canTransitionUploadSlot("issued", "upload_observed")).toBe(true);
    expect(canTransitionUploadSlot("upload_observed", "committed")).toBe(true);
    expect(canTransitionUploadSlot("committed", "announced")).toBe(true);
    expect(canTransitionUploadSlot("issued", "expired")).toBe(true);
    expect(canTransitionUploadSlot("issued", "revoked")).toBe(true);
    expect(canTransitionUploadSlot("upload_observed", "rejected")).toBe(true);
    expect(canTransitionUploadSlot("upload_observed", "revoked")).toBe(true);
    expect(canTransitionUploadSlot("committed", "revoked")).toBe(true);
  });

  test("rejects unspecified transitions", () => {
    expect(canTransitionUploadSlot("announced", "revoked")).toBe(false);
    expect(canTransitionUploadSlot("expired", "issued")).toBe(false);
    expect(canTransitionUploadSlot("rejected", "committed")).toBe(false);
  });

  test("throws for invalid transitions", () => {
    expect(() => assertUploadSlotTransition("announced", "revoked")).toThrow(
      "Invalid upload slot transition: announced -> revoked"
    );
  });
});

describe("observe upload", () => {
  test("marks an issued slot as upload observed", () => {
    expect(observeUpload({ object, slot })).toEqual({
      ...slot,
      state: "upload_observed",
    });
  });

  test("keeps already observed slots idempotent", () => {
    const observedSlot: UploadSlot = { ...slot, state: "upload_observed" };

    expect(observeUpload({ object, slot: observedSlot })).toEqual(observedSlot);
  });

  test("rejects object mismatches", () => {
    expect(() =>
      observeUpload({
        object: { ...object, objectKey: "other/key.m4s" },
        slot,
      })
    ).toThrow("observedUpload.objectKey must match uploadSlot.objectKey");
  });

  test("rejects non-observable slots", () => {
    expect(() =>
      observeUpload({
        object,
        slot: { ...slot, state: "committed" },
      })
    ).toThrow("uploadSlot.state must be issued or upload_observed");
  });
});
