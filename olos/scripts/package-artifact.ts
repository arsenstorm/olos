import { join } from "node:path";
import { packageReleaseTag } from "./release-metadata";

export function packageArtifactPath(
  artifactRoot: string,
  version: string
): string {
  return join(artifactRoot, `${packageReleaseTag(version)}.tgz`);
}
