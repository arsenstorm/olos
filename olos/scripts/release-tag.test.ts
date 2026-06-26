import { describe, expect, test } from "bun:test";
import { assertReleaseTag } from "./release-tag";

describe("release tag verifier", () => {
  test("accepts the expected package release tag", () => {
    expect(() => assertReleaseTag("olos-v0.1.0", "olos-v0.1.0")).not.toThrow();
  });

  test("rejects missing or mismatched release tags", () => {
    expect(() => assertReleaseTag(undefined, "olos-v0.1.0")).toThrow(
      "release tag must be olos-v0.1.0"
    );
    expect(() => assertReleaseTag("v0.1.0", "olos-v0.1.0")).toThrow(
      "release tag must be olos-v0.1.0"
    );
    expect(() => assertReleaseTag("olos-v0.1.1", "olos-v0.1.0")).toThrow(
      "release tag must be olos-v0.1.0"
    );
  });
});
