import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  packageArtifactPath,
  packageReleaseTag,
  packageVersion,
  releaseVersionEnvName,
  releaseVersionFromCli,
  releaseVersionFromEnv,
} from "./release-metadata";

describe("release metadata", () => {
  test("derives release tag and artifact names from the package version", () => {
    expect(packageReleaseTag("0.1.0")).toBe("olos-v0.1.0");
    expect(packageArtifactPath("/tmp/artifacts", "0.1.0")).toBe(
      join("/tmp/artifacts", "olos-v0.1.0.tgz")
    );
  });

  test("uses package metadata as the default release version", () => {
    expect(releaseVersionFromEnv({})).toBe(packageVersion);
    expect(releaseVersionFromCli(["bun", "script"], {})).toBe(packageVersion);
  });

  test("lets env override the default release version", () => {
    expect(
      releaseVersionFromEnv({
        [releaseVersionEnvName]: "0.2.0",
      })
    ).toBe("0.2.0");
  });

  test("lets cli args override env release version", () => {
    expect(
      releaseVersionFromCli(["bun", "script", "0.3.0"], {
        [releaseVersionEnvName]: "0.2.0",
      })
    ).toBe("0.3.0");
  });
});
