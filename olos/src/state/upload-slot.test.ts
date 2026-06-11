import { describe, expect, test } from "bun:test";

import {
  assertUploadSlotTransition,
  canTransitionUploadSlot,
} from "./upload-slot";

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
