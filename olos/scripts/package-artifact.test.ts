import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { packageArtifactPath } from "./package-artifact";
import { packageArtifactPath as releaseMetadataPackageArtifactPath } from "./release-metadata";

describe("package artifact path", () => {
  test("names release artifacts with the package version", () => {
    expect(packageArtifactPath("/tmp/artifacts", "0.1.0")).toBe(
      join("/tmp/artifacts", "olos-v0.1.0.tgz")
    );
  });

  test("uses the shared release metadata artifact path helper", () => {
    expect(packageArtifactPath).toBe(releaseMetadataPackageArtifactPath);
  });
});
