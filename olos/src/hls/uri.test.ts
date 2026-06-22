import { describe, expect, test } from "bun:test";
import {
  assertSafeMediaUri,
  assertSafeRelativePath,
  HLS_RELATIVE_REQUEST_BASE_URL,
} from "./uri";

const mediaOrigin = "https://media.example.com";

describe("HLS URI helpers", () => {
  test("validates safe relative paths", () => {
    expect(() =>
      assertSafeRelativePath("/live/session/v1080/media.m3u8", "path")
    ).not.toThrow();
    expect(() => assertSafeRelativePath("live/session", "path")).toThrow(
      "path must be a safe relative path"
    );
    expect(() => assertSafeRelativePath("//evil.example/path", "path")).toThrow(
      "path must be a safe relative path"
    );
    expect(() =>
      assertSafeRelativePath("/live/media.m3u8?x=1", "path")
    ).toThrow("path must not contain query strings or fragments");
  });

  test("validates relative and allowed absolute media URIs", () => {
    expect(() =>
      assertSafeMediaUri("/live/session/v1080/3810.m4s", {}, "uri")
    ).not.toThrow();
    expect(() =>
      assertSafeMediaUri(
        "https://media.example.com/live/3810.m4s",
        { allowedMediaOrigins: [mediaOrigin] },
        "uri"
      )
    ).not.toThrow();
  });

  test("rejects unsafe or disallowed media URIs", () => {
    expect(() => assertSafeMediaUri("", {}, "uri")).toThrow(
      "uri must be a non-empty string"
    );
    expect(() => assertSafeMediaUri("bad\nuri", {}, "uri")).toThrow(
      "uri must not contain control characters"
    );
    expect(() =>
      assertSafeMediaUri("http://media.example.com/live/3810.m4s", {}, "uri")
    ).toThrow("uri must use https");
    expect(() =>
      assertSafeMediaUri("https://other.example.com/live/3810.m4s", {}, "uri")
    ).toThrow("uri origin is not allowed");
    expect(() =>
      assertSafeMediaUri("//media.example.com/live.m4s", {}, "uri")
    ).toThrow("uri must be a safe relative path");
    expect(() => assertSafeMediaUri("s3://bucket/key", {}, "uri")).toThrow(
      "uri must be a safe relative path or allowed absolute URL"
    );
  });

  test("exposes a stable base URL for relative HLS request parsing", () => {
    expect(
      new URL("/live/session/master.m3u8", HLS_RELATIVE_REQUEST_BASE_URL).href
    ).toBe("https://olos.local/live/session/master.m3u8");
  });
});
