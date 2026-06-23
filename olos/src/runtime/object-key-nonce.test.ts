import { describe, expect, test } from "bun:test";
import {
  createRuntimePublisherObjectKeyNonce,
  RUNTIME_PUBLISHER_OBJECT_KEY_NONCE_MIN_BYTES,
} from "./object-key-nonce";

describe("runtime object key nonce", () => {
  test("creates a URL-safe nonce from app-supplied entropy bytes", () => {
    expect(
      createRuntimePublisherObjectKeyNonce({
        bytes: new Uint8Array([
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 255,
        ]),
      })
    ).toBe("slot_000102030405060708090a0b0c0d0eff");
  });

  test("supports an app-owned prefix", () => {
    expect(
      createRuntimePublisherObjectKeyNonce({
        bytes: new Uint8Array(RUNTIME_PUBLISHER_OBJECT_KEY_NONCE_MIN_BYTES),
        prefix: "obj",
      })
    ).toBe("obj_00000000000000000000000000000000");
  });

  test("rejects weak or unsafe nonce inputs", () => {
    expect(() =>
      createRuntimePublisherObjectKeyNonce({
        bytes: [] as unknown as Uint8Array,
      })
    ).toThrow("objectKeyNonce bytes must be a Uint8Array");

    expect(() =>
      createRuntimePublisherObjectKeyNonce({
        bytes: new Uint8Array(RUNTIME_PUBLISHER_OBJECT_KEY_NONCE_MIN_BYTES - 1),
      })
    ).toThrow("objectKeyNonce bytes must contain at least 16 bytes");

    expect(() =>
      createRuntimePublisherObjectKeyNonce({
        bytes: new Uint8Array(RUNTIME_PUBLISHER_OBJECT_KEY_NONCE_MIN_BYTES),
        prefix: "../slot",
      })
    ).toThrow("objectKeyNonce prefix must be a non-empty URL-safe identifier");
  });
});
