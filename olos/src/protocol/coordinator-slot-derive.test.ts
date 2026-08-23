import { describe, expect, test } from "bun:test";
import { issueCoordinatorSlot } from "./coordinator-slot";
import { createEmptyCoordinatorState } from "./coordinator-state.test-helper";

const NONCE_OBJECT_KEY = /^objects\/v1080\/init-slot_[0-9a-f]{32}$/;

describe("issueCoordinatorSlot derived addresses", () => {
  const baseOptions = {
    contentType: "video/mp4",
    expiresAt: "2026-01-01T00:00:05.000Z",
    maxBytes: 100_000,
    profile: { duration: 2 },
    trackId: "v1080",
  } as const;

  test("derives objectKey and deliveryUrl when omitted", () => {
    const state = {
      ...createEmptyCoordinatorState(),
      publicationMode: "read-gated" as const,
    };
    const result = issueCoordinatorSlot({
      ...baseOptions,
      kind: "segment",
      sequenceNumber: 3810,
      slotId: "slot_3810",
      state,
    });

    expect(result.slot.objectKey).toBe("objects/v1080/s3810");
    expect(result.slot.deliveryUrl).toBe(
      "https://media.example.com/objects/v1080/s3810"
    );
  });

  test("generates a nonce in direct-public mode", () => {
    const state = {
      ...createEmptyCoordinatorState(),
      publicationMode: "direct-public" as const,
    };
    const result = issueCoordinatorSlot({
      ...baseOptions,
      kind: "init",
      sequenceNumber: 0,
      slotId: "slot_init",
      state,
    });

    expect(result.slot.objectKey).toMatch(NONCE_OBJECT_KEY);
    expect(result.slot.deliveryUrl).toBe(
      `https://media.example.com/${result.slot.objectKey}`
    );
  });

  test("honors a publisher-supplied nonce in direct-public mode", () => {
    const state = {
      ...createEmptyCoordinatorState(),
      publicationMode: "direct-public" as const,
    };
    const result = issueCoordinatorSlot({
      ...baseOptions,
      kind: "segment",
      objectKeyNonce: "slot_abcd",
      sequenceNumber: 3810,
      slotId: "slot_3810",
      state,
    });

    expect(result.slot.objectKey).toBe("objects/v1080/s3810-slot_abcd");
  });
});
