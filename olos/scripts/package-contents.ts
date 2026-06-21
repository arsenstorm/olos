import { readdir } from "node:fs/promises";
import { listDirectoryEntries } from "./directory-walk";

export const packagePublicRootEntries = [
  "LICENSE",
  "README.md",
  "dist",
  "package.json",
] as const;

export const packagePrivateRootEntries = [
  "e2e",
  "fixtures",
  "live",
  "scripts",
  "src",
] as const;

const forbiddenPackagePaths = [
  ...packagePrivateRootEntries.map((entry) => new RegExp(`^${entry}(?:/|$)`)),
  /(?:^|\/)[^/]+\.(?:test|spec|test-helper)(?:\.d)?\.[cm]?[jt]s$/,
  /(?:^|\/)tsconfig(?:\.[^.]+)?\.json$/,
] as const;

export async function assertInstalledPackageContents(
  packageRoot: string
): Promise<void> {
  const rootEntries = (await readdir(packageRoot, { withFileTypes: true }))
    .map((entry) => entry.name)
    .sort();

  assertList("package root entries", rootEntries, packagePublicRootEntries);

  for (const entry of await listDirectoryEntries(packageRoot)) {
    if (
      forbiddenPackagePaths.some((pattern) => pattern.test(entry.relativePath))
    ) {
      throw new Error(`package contains private file: ${entry.relativePath}`);
    }
  }
}

function assertList(
  name: string,
  actual: readonly string[],
  expected: readonly string[]
): void {
  const actualList = [...actual].sort();
  const expectedList = [...expected].sort();

  if (JSON.stringify(actualList) !== JSON.stringify(expectedList)) {
    throw new Error(
      `${name} mismatch: expected ${expectedList.join(", ")}, received ${actualList.join(", ")}`
    );
  }
}
