import { describe, expect, test } from "bun:test";
import type { UploadSlot } from "../types/upload-slot";
import {
  assertObservedUploadMatchesSlot,
  type ObservedUpload,
  observedUploadMatchesSlot,
} from "./observed-upload";
import { invalidStringMapFixture } from "./test-string-map.test-helper";

const slot: UploadSlot = {
  contentType: "video/mp4",
  deliveryUrl: "https://media.example.com/media/v1080/s3810.m4s",
  duration: 2,
  epoch: 0,
  expiresAt: "2026-01-01T00:00:05.000Z",
  kind: "segment",
  maxBytes: 100_000,
  mediaSequenceNumber: 3810,
  minBytes: 1000,
  objectKey: "media/v1080/s3810.m4s",
  renditionId: "v1080",
  sessionId: "session_1",
  slotId: "slot_1",
  state: "issued",
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

describe("observed upload validation", () => {
  test("accepts an observed object that matches its upload slot", () => {
    expect(observedUploadMatchesSlot({ object, slot })).toBe(true);
  });

  test("accepts upload_observed slots for idempotent observation", () => {
    expect(() =>
      assertObservedUploadMatchesSlot({
        object,
        slot: { ...slot, state: "upload_observed" },
      })
    ).not.toThrow();
  });

  test("rejects non-observable slot states", () => {
    expect(() =>
      assertObservedUploadMatchesSlot({
        object,
        slot: { ...slot, state: "committed" },
      })
    ).toThrow("uploadSlot.state must be issued or upload_observed");
  });

  test("rejects object key mismatches", () => {
    expect(() =>
      assertObservedUploadMatchesSlot({
        object: { ...object, objectKey: "other/key.m4s" },
        slot,
      })
    ).toThrow("observedUpload.objectKey must match uploadSlot.objectKey");
  });

  test("rejects content type mismatches", () => {
    expect(() =>
      assertObservedUploadMatchesSlot({
        object: { ...object, contentType: "application/octet-stream" },
        slot,
      })
    ).toThrow("observedUpload.contentType must match uploadSlot.contentType");
  });

  test("rejects objects above the slot byte limit", () => {
    expect(() =>
      assertObservedUploadMatchesSlot({
        object: { ...object, size: 100_001 },
        slot,
      })
    ).toThrow(
      "observedUpload.size must be less than or equal to uploadSlot.maxBytes"
    );
  });

  test("rejects objects below the slot byte limit", () => {
    expect(() =>
      assertObservedUploadMatchesSlot({
        object: { ...object, size: 999 },
        slot,
      })
    ).toThrow(
      "observedUpload.size must be greater than or equal to uploadSlot.minBytes"
    );
  });

  test("accepts object sizes exactly at slot byte limits", () => {
    expect(() =>
      assertObservedUploadMatchesSlot({
        object: { ...object, size: slot.minBytes ?? 0 },
        slot,
      })
    ).not.toThrow();
    expect(() =>
      assertObservedUploadMatchesSlot({
        object: { ...object, size: slot.maxBytes },
        slot,
      })
    ).not.toThrow();
  });

  test("rejects objects observed after slot expiry", () => {
    expect(() =>
      assertObservedUploadMatchesSlot({
        object: { ...object, observedAt: "2026-01-01T00:00:06.000Z" },
        slot,
      })
    ).toThrow(
      "observedUpload.observedAt must be before or equal to uploadSlot.expiresAt"
    );
  });

  test("allows observations within configured late tolerance", () => {
    expect(() =>
      assertObservedUploadMatchesSlot({
        lateToleranceMs: 1000,
        object: { ...object, observedAt: "2026-01-01T00:00:05.500Z" },
        slot,
      })
    ).not.toThrow();
  });

  test("allows observations exactly at the tolerated expiry deadline", () => {
    expect(() =>
      assertObservedUploadMatchesSlot({
        lateToleranceMs: 1000,
        object: { ...object, observedAt: "2026-01-01T00:00:06.000Z" },
        slot,
      })
    ).not.toThrow();
  });

  test("rejects invalid late tolerance", () => {
    expect(() =>
      assertObservedUploadMatchesSlot({
        lateToleranceMs: -1,
        object,
        slot,
      })
    ).toThrow("lateToleranceMs must be a non-negative number");
  });

  test("rejects slot id metadata mismatches when metadata is available", () => {
    expect(() =>
      assertObservedUploadMatchesSlot({
        object: {
          ...object,
          metadata: {
            "x-olos-slot-id": "slot_2",
          },
        },
        slot,
      })
    ).toThrow(
      "observedUpload.metadata.x-olos-slot-id must match uploadSlot.slotId"
    );
  });

  test("allows missing slot id metadata", () => {
    expect(() =>
      assertObservedUploadMatchesSlot({
        object: { ...object, metadata: undefined },
        slot,
      })
    ).not.toThrow();
  });

  test("rejects invalid metadata", () => {
    expect(() =>
      assertObservedUploadMatchesSlot({
        object: {
          ...object,
          metadata: null as never,
        },
        slot,
      })
    ).toThrow("observedUpload.metadata must be a string map");

    expect(() =>
      assertObservedUploadMatchesSlot({
        object: {
          ...object,
          metadata: invalidStringMapFixture({
            checksum: 123,
          }),
        },
        slot,
      })
    ).toThrow("observedUpload.metadata must be a string map");

    expect(() =>
      assertObservedUploadMatchesSlot({
        object: {
          ...object,
          metadata: {
            "bad metadata": "slot_1",
          },
        },
        slot,
      })
    ).toThrow("observedUpload.metadata must be a string map");
  });
});
