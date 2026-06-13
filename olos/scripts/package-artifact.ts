import { join } from "node:path";

export function packageArtifactPath(
  artifactRoot: string,
  version: string
): string {
  return join(artifactRoot, `olos-v${version}.tgz`);
}
