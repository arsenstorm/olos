import { describe, expect, test } from "bun:test";
import { assertSafeObjectKey, isSafeObjectKey } from "./object-key";

describe("object key validation", () => {
  test("accepts safe relative object keys", () => {
    expect(isSafeObjectKey("media/session/v1080/3810.m4s")).toBe(true);
    expect(() =>
      assertSafeObjectKey("media/session/v1080/3810.m4s", "objectKey")
    ).not.toThrow();
  });

  test("rejects query strings and fragments", () => {
    expect(isSafeObjectKey("media/session/v1080/3810.m4s?etag=abc")).toBe(
      false
    );
    expect(() =>
      assertSafeObjectKey("media/session/v1080/3810.m4s#part", "objectKey")
    ).toThrow("objectKey must not contain query strings or fragments");
  });
});
