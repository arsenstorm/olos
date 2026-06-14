import { describe, expect, test } from "bun:test";
import { assertPublishedPackageVersion } from "./published-package";

describe("published package verifier", () => {
  test("accepts released package versions", () => {
    expect(() => assertPublishedPackageVersion("0.1.0")).not.toThrow();
  });

  test("rejects the unpublished placeholder version", () => {
    expect(() => assertPublishedPackageVersion("0.0.0")).toThrow(
      "published package verification requires a released version"
    );
  });

  test("rejects non-version package selectors", () => {
    expect(() => assertPublishedPackageVersion("latest")).toThrow(
      "published package verification requires a semantic version"
    );
    expect(() => assertPublishedPackageVersion("olos-v0.1.0")).toThrow(
      "published package verification requires a semantic version"
    );
  });
});
