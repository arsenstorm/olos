import { describe, expect, test } from "bun:test";
import { optionalField } from "./optional-field";

describe("optionalField", () => {
  test("includes defined values", () => {
    expect(optionalField("maxSegments", 3)).toEqual({ maxSegments: 3 });
    expect(optionalField("enabled", false)).toEqual({ enabled: false });
  });

  test("omits undefined values", () => {
    expect(optionalField("maxSegments", undefined)).toEqual({});
  });
});
