import { describe, expect, test } from "bun:test";
import type { Cursor } from "../types/cursor";
import type { Session } from "../types/session";
import type { UploadSlot } from "../types/upload-slot";
import type { ObservedUpload } from "../validation/observed-upload";

import { createIssuedUploadSlot } from "./upload-slot";
import {
  assertUploadSlotTransition,
  canTransitionUploadSlot,
  observeUpload,
  resolveUploadExpiry,
  resolveUploadObservation,
  resolveUploadRejection,
  resolveUploadRevocation,
  revokeUpload,
} from "./upload-slot-observe";

const session: Session = {
  createdAt: "2026-01-01T00:00:00.000Z",
  epoch: 0,
  olos: "1.0",
  profile: { id: "cmaf-llhls", partTarget: 0.5, segmentTarget: 2 },
  sessionId: "session_1",
  state: "live",
  tracks: [
    {
      profile: {
        bitrate: 5_000_000,
        codec: "avc1.640028",
        frameRate: 30,
        height: 1080,
        kind: "video",
        width: 1920,
      },
      trackId: "v1080",
    },
  ],
};

const slot: UploadSlot = {
  contentType: "video/mp4",
  deliveryUrl: "https://media.example.com/media/v1080/s3810.m4s",
  epoch: 0,
  expiresAt: "2026-01-01T00:00:05.000Z",
  kind: "segment",
  maxBytes: 100_000,
  minBytes: 1000,
  objectKey: "media/v1080/s3810.m4s",
  profile: { duration: 2 },
  sequenceNumber: 3810,
  sessionId: "session_1",
  slotId: "slot_1",
  state: "issued",
  trackId: "v1080",
};

const object: ObservedUpload = {
  contentType: "video/mp4",
  etag: "abc123",
  metadata: {
    "x-olos-slot-id": "slot_1",
  },
  objectKey: "media/v1080/s3810.m4s",
  observedAt: "2026-01-01T00:00:03.000Z",
  providerId: "s3_primary",
  size: 50_000,
};

const cursor: Cursor = {
  committedWindow: {
    epoch: 0,
    firstSequenceNumber: 3810,
    lastSequenceNumber: 3810,
    tracks: {
      v1080: {
        init: {
          commitId: "commit_init",
          deliveryUrl: "/media/v1080/init.mp4",
          objectKey: "media/v1080/init.mp4",
          slotId: "slot_init",
        },
        segments: [
          {
            segment: {
              commitId: "commit_3810",
              deliveryUrl: "/media/3810.m4s",
              objectKey: "media/3810.m4s",
              profile: { duration: 2 },
              slotId: "slot_3810",
            },
            sequenceNumber: 3810,
          },
        ],
        trackId: "v1080",
      },
    },
  },
  deliveryBaseUrl: "https://media.example.com",
  epoch: 0,
  olos: "1.0",
  profile: { id: "cmaf-llhls", partTarget: 0.5, segmentTarget: 2 },
  sessionId: "session_1",
  state: "live",
  updatedAt: "2026-01-01T00:00:02.000Z",
  window: {
    firstSequenceNumber: 3810,
    lastSequenceNumber: 3810,
  },
};

describe("upload slot issuance", () => {
  test("creates an issued slot for a live session", () => {
    expect(
      createIssuedUploadSlot({
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/media/v1080/s3810.m4s",
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "segment",
        maxBytes: 100_000,
        minBytes: 1000,
        objectKey: "media/v1080/s3810.m4s",
        profile: { duration: 2 },
        sequenceNumber: 3810,
        session,
        slotId: "slot_1",
        trackId: "v1080",
      })
    ).toEqual(slot);
  });

  test("creates issued part slots with optional part numbers", () => {
    expect(
      createIssuedUploadSlot({
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/live/session/v1080/3810/0.m4s",
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "part",
        maxBytes: 100_000,
        objectKey: "live/session/v1080/3810/0.m4s",
        partNumber: 0,
        profile: { duration: 0.5 },
        sequenceNumber: 3810,
        session,
        slotId: "slot_3810_0",
        trackId: "v1080",
      }).partNumber
    ).toBe(0);
  });

  test("rejects non-live sessions", () => {
    expect(() =>
      createIssuedUploadSlot({
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/media/v1080/s3810.m4s",
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "segment",
        maxBytes: 100_000,
        objectKey: "media/v1080/s3810.m4s",
        profile: { duration: 2 },
        sequenceNumber: 3810,
        session: { ...session, state: "ended" },
        slotId: "slot_1",
        trackId: "v1080",
      })
    ).toThrow("session.state must be live");
  });

  test("rejects tracks outside the session", () => {
    expect(() =>
      createIssuedUploadSlot({
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/live/session/v720/3810.m4s",
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "segment",
        maxBytes: 100_000,
        objectKey: "live/session/v720/3810.m4s",
        profile: { duration: 2 },
        sequenceNumber: 3810,
        session,
        slotId: "slot_1",
        trackId: "v720",
      })
    ).toThrow("uploadSlot.trackId must belong to session.tracks");
  });
});

describe("upload slot transitions", () => {
  test("allows spec-defined transitions", () => {
    expect(canTransitionUploadSlot("issued", "upload_observed")).toBe(true);
    expect(canTransitionUploadSlot("upload_observed", "committed")).toBe(true);
    expect(canTransitionUploadSlot("issued", "expired")).toBe(true);
    expect(canTransitionUploadSlot("issued", "revoked")).toBe(true);
    expect(canTransitionUploadSlot("upload_observed", "rejected")).toBe(true);
    expect(canTransitionUploadSlot("upload_observed", "revoked")).toBe(true);
    expect(canTransitionUploadSlot("committed", "revoked")).toBe(true);
  });

  test("rejects unspecified transitions", () => {
    expect(canTransitionUploadSlot("expired", "issued")).toBe(false);
    expect(canTransitionUploadSlot("rejected", "committed")).toBe(false);
    expect(canTransitionUploadSlot("revoked", "committed")).toBe(false);
  });

  test("throws for invalid transitions", () => {
    expect(() => assertUploadSlotTransition("expired", "revoked")).toThrow(
      "Invalid upload slot transition: expired -> revoked"
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

  test("returns an observation result without advancing the cursor", () => {
    expect(resolveUploadObservation({ cursor, object, slot })).toEqual({
      cursor,
      cursorAdvanced: false,
      slot: {
        ...slot,
        state: "upload_observed",
      },
      status: "observed",
    });
  });

  test("keeps already observed slots idempotent", () => {
    const observedSlot: UploadSlot = { ...slot, state: "upload_observed" };

    expect(observeUpload({ object, slot: observedSlot })).toEqual(observedSlot);
    expect(
      resolveUploadObservation({ cursor, object, slot: observedSlot })
    ).toEqual({
      cursor,
      cursorAdvanced: false,
      slot: observedSlot,
      status: "already_observed",
    });
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

describe("expire upload", () => {
  test("returns an expiry result", () => {
    expect(
      resolveUploadExpiry({
        now: "2026-01-01T00:00:06.000Z",
        slot,
      })
    ).toEqual({
      slot: {
        ...slot,
        state: "expired",
      },
      status: "expired",
    });
  });

  test("keeps expired slots idempotent", () => {
    const expiredSlot: UploadSlot = { ...slot, state: "expired" };

    expect(
      resolveUploadExpiry({
        now: "2026-01-01T00:00:06.000Z",
        slot: expiredSlot,
      })
    ).toEqual({
      slot: expiredSlot,
      status: "already_expired",
    });
  });

  test("keeps expired slots idempotent before checking the expiry time", () => {
    const expiredSlot: UploadSlot = { ...slot, state: "expired" };

    expect(
      resolveUploadExpiry({
        now: "2026-01-01T00:00:04.999Z",
        slot: expiredSlot,
      })
    ).toEqual({
      slot: expiredSlot,
      status: "already_expired",
    });
  });

  test("rejects premature expiry", () => {
    expect(() =>
      resolveUploadExpiry({
        now: "2026-01-01T00:00:04.999Z",
        slot,
      })
    ).toThrow("now must be after or equal to uploadSlot.expiresAt");
  });

  test("rejects invalid expiry timestamps", () => {
    expect(() =>
      resolveUploadExpiry({
        now: "soon",
        slot,
      })
    ).toThrow("now must be a valid timestamp");
  });

  test("rejects non-expirable slots", () => {
    expect(() =>
      resolveUploadExpiry({
        now: "2026-01-01T00:00:06.000Z",
        slot: { ...slot, state: "upload_observed" },
      })
    ).toThrow("Invalid upload slot transition: upload_observed -> expired");
  });
});

describe("reject upload", () => {
  const observedSlot: UploadSlot = { ...slot, state: "upload_observed" };

  test("returns a rejection result", () => {
    expect(resolveUploadRejection({ slot: observedSlot })).toEqual({
      slot: {
        ...observedSlot,
        state: "rejected",
      },
      status: "rejected",
    });
  });

  test("keeps rejected slots idempotent", () => {
    const rejectedSlot: UploadSlot = { ...slot, state: "rejected" };

    expect(resolveUploadRejection({ slot: rejectedSlot })).toEqual({
      slot: rejectedSlot,
      status: "already_rejected",
    });
  });

  test("rejects non-rejectable slots", () => {
    expect(() => resolveUploadRejection({ slot })).toThrow(
      "Invalid upload slot transition: issued -> rejected"
    );
  });
});

describe("revoke upload", () => {
  test("revokes issued, observed, and committed slots", () => {
    for (const state of ["issued", "upload_observed", "committed"] as const) {
      expect(revokeUpload({ slot: { ...slot, state } })).toEqual({
        ...slot,
        state: "revoked",
      });
    }
  });

  test("returns a revocation result", () => {
    expect(resolveUploadRevocation({ slot })).toEqual({
      slot: {
        ...slot,
        state: "revoked",
      },
      status: "revoked",
    });
  });

  test("keeps revoked slots idempotent", () => {
    const revokedSlot: UploadSlot = { ...slot, state: "revoked" };

    expect(resolveUploadRevocation({ slot: revokedSlot })).toEqual({
      slot: revokedSlot,
      status: "already_revoked",
    });
  });

  test("rejects non-revokable slots", () => {
    expect(() =>
      revokeUpload({ slot: { ...slot, state: "rejected" } })
    ).toThrow("Invalid upload slot transition: rejected -> revoked");
  });
});
