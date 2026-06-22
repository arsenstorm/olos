import { describe, expect, test } from "bun:test";
import { assertSafeDeliveryUrl } from "./delivery-url";

describe("delivery URL validation", () => {
  test("accepts absolute HTTP URLs and safe relative paths", () => {
    expect(() =>
      assertSafeDeliveryUrl("https://media.example.com/live/3810.m4s", "url")
    ).not.toThrow();
    expect(() =>
      assertSafeDeliveryUrl("/live/session/v1080/3810.m4s", "url")
    ).not.toThrow();
  });

  test("rejects empty values and control characters", () => {
    expect(() => assertSafeDeliveryUrl("", "url")).toThrow(
      "url must be a non-empty string"
    );
    expect(() => assertSafeDeliveryUrl("bad\nurl", "url")).toThrow(
      "url must not contain control characters"
    );
  });

  test("rejects query strings, fragments, and unsafe paths", () => {
    expect(() =>
      assertSafeDeliveryUrl("/live/3810.m4s?token=1", "url")
    ).toThrow("url must not contain query strings or fragments");
    expect(() => assertSafeDeliveryUrl("/live/../secret.m4s", "url")).toThrow(
      "url must be an absolute HTTP(S) URL or safe relative path"
    );
    expect(() =>
      assertSafeDeliveryUrl("//cdn.example.com/live.m4s", "url")
    ).toThrow("url must be an absolute HTTP(S) URL or safe relative path");
    expect(() => assertSafeDeliveryUrl("s3://bucket/key", "url")).toThrow(
      "url must be an absolute HTTP(S) URL or safe relative path"
    );
  });
});
