import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };

export const packageVersion = packageJson.version;
export const releaseVersionEnvName = "OLOS_RELEASE_VERSION";

export function packageReleaseTag(version: string = packageVersion): string {
  return `olos-v${version}`;
}

export function packageArtifactPath(
  artifactRoot: string,
  version: string = packageVersion
): string {
  return join(artifactRoot, `${packageReleaseTag(version)}.tgz`);
}

export function releaseVersionFromEnv(
  env: Record<string, string | undefined> = process.env
): string {
  return env[releaseVersionEnvName] ?? packageVersion;
}

export function releaseVersionFromCli(
  args: readonly string[] = process.argv,
  env: Record<string, string | undefined> = process.env
): string {
  return args[2] ?? releaseVersionFromEnv(env);
}
