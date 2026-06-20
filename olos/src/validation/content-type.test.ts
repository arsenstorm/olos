import { describe, expect, test } from "bun:test";
import { assertContentType, isContentType } from "./content-type";

describe("content type validation", () => {
  test("accepts valid content types", () => {
    expect(isContentType("video/mp4")).toBe(true);
    expect(isContentType('application/json; charset="utf-8"')).toBe(true);
  });

  test("rejects invalid content types", () => {
    expect(isContentType("video")).toBe(false);
    expect(isContentType("video/mp4; bad parameter")).toBe(false);
    expect(isContentType(1)).toBe(false);
  });

  test("asserts valid content types", () => {
    expect(() => assertContentType("video/mp4", "contentType")).not.toThrow();
    expect(() => assertContentType("video", "contentType")).toThrow(
      "contentType must be a valid content type"
    );
  });
});
