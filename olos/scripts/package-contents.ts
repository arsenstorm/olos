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
  assertList(
    "package root entries",
    await packageRootEntryNames(packageRoot),
    packagePublicRootEntries
  );
  await assertNoForbiddenPackagePaths(packageRoot);
}

async function packageRootEntryNames(packageRoot: string): Promise<string[]> {
  return (await readdir(packageRoot, { withFileTypes: true }))
    .map((entry) => entry.name)
    .sort();
}

async function assertNoForbiddenPackagePaths(
  packageRoot: string
): Promise<void> {
  const forbiddenPath = await firstForbiddenPackagePath(packageRoot);

  if (forbiddenPath !== undefined) {
    throw new Error(`package contains private file: ${forbiddenPath}`);
  }
}

async function firstForbiddenPackagePath(
  packageRoot: string
): Promise<string | undefined> {
  for (const entry of await listDirectoryEntries(packageRoot)) {
    if (isForbiddenPackagePath(entry.relativePath)) {
      return entry.relativePath;
    }
  }
}

function isForbiddenPackagePath(relativePath: string): boolean {
  return forbiddenPackagePaths.some((pattern) => pattern.test(relativePath));
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
