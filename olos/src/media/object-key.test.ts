import { describe, expect, test } from "bun:test";
import {
  assertSafeMediaObjectKey,
  assertSupportedMediaExtension,
  DEFAULT_MEDIA_OBJECT_EXTENSIONS,
  MEDIA_OBJECT_EXTENSIONS,
} from "./object-key";

describe("media object key validation", () => {
  test("accepts supported media object extensions", () => {
    expect(() =>
      assertSafeMediaObjectKey("media/v1080/init.mp4", "init", "objectKey")
    ).not.toThrow();
    expect(() =>
      assertSafeMediaObjectKey("media/3810.m4s", "segment", "objectKey")
    ).not.toThrow();
    expect(() =>
      assertSupportedMediaExtension("m4s", "part", "extension")
    ).not.toThrow();
  });

  test("pairs default extensions with the supported list", () => {
    for (const [kind, extension] of Object.entries(
      DEFAULT_MEDIA_OBJECT_EXTENSIONS
    )) {
      expect(
        MEDIA_OBJECT_EXTENSIONS[kind as keyof typeof MEDIA_OBJECT_EXTENSIONS]
      ).toContain(`.${extension}`);
    }
  });

  test("rejects unsafe media object keys", () => {
    expect(() =>
      assertSafeMediaObjectKey("media/../init.mp4", "init", "objectKey")
    ).toThrow("objectKey must be a safe relative object key");
  });

  test("rejects unsupported media object extensions", () => {
    expect(() =>
      assertSafeMediaObjectKey("media/init.m4s", "init", "objectKey")
    ).toThrow("objectKey must use a supported media extension");
    expect(() =>
      assertSupportedMediaExtension("mp4", "segment", "extension")
    ).toThrow("extension must use a supported media extension");
  });
});
