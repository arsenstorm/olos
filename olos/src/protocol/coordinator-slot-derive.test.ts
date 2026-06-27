import { describe, expect, test } from "bun:test";
import { issueCoordinatorSlot } from "./coordinator";
import { createEmptyCoordinatorState } from "./coordinator-state.test-helper";

const NONCE_OBJECT_KEY = /^media\/v1080\/init-slot_[0-9a-f]{32}\.mp4$/;

describe("issueCoordinatorSlot derived addresses", () => {
  const baseOptions = {
    contentType: "video/mp4",
    duration: 2,
    expiresAt: "2026-01-01T00:00:05.000Z",
    maxBytes: 100_000,
    renditionId: "v1080",
  } as const;

  test("derives objectKey and deliveryUrl when omitted", () => {
    const state = {
      ...createEmptyCoordinatorState(),
      publicationMode: "read-gated" as const,
    };
    const result = issueCoordinatorSlot({
      ...baseOptions,
      kind: "segment",
      mediaSequenceNumber: 3810,
      slotId: "slot_3810",
      state,
    });

    expect(result.slot.objectKey).toBe("media/v1080/s3810.m4s");
    expect(result.slot.deliveryUrl).toBe(
      "https://media.example.com/media/v1080/s3810.m4s"
    );
  });

  test("generates a nonce in direct-public mode", () => {
    const state = createEmptyCoordinatorState();
    const result = issueCoordinatorSlot({
      ...baseOptions,
      kind: "init",
      mediaSequenceNumber: 0,
      slotId: "slot_init",
      state,
    });

    expect(result.slot.objectKey).toMatch(NONCE_OBJECT_KEY);
    expect(result.slot.deliveryUrl).toBe(
      `https://media.example.com/${result.slot.objectKey}`
    );
  });

  test("preserves publisher-supplied objectKey and deliveryUrl", () => {
    const state = createEmptyCoordinatorState();
    const result = issueCoordinatorSlot({
      ...baseOptions,
      deliveryUrl: "https://media.example.com/explicit/key.m4s",
      kind: "segment",
      mediaSequenceNumber: 3810,
      objectKey: "explicit/key.m4s",
      slotId: "slot_explicit",
      state,
    });

    expect(result.slot.objectKey).toBe("explicit/key.m4s");
    expect(result.slot.deliveryUrl).toBe(
      "https://media.example.com/explicit/key.m4s"
    );
  });

  test("honors a publisher-supplied nonce in direct-public mode", () => {
    const state = createEmptyCoordinatorState();
    const result = issueCoordinatorSlot({
      ...baseOptions,
      kind: "segment",
      mediaSequenceNumber: 3810,
      objectKeyNonce: "slot_abcd",
      slotId: "slot_3810",
      state,
    });

    expect(result.slot.objectKey).toBe(
      "media/v1080/s3810/segment-slot_abcd.m4s"
    );
  });
});
