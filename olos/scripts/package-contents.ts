import { readdir } from "node:fs/promises";
import { join } from "node:path";

const expectedRootEntries = ["LICENSE", "README.md", "dist", "package.json"];

const forbiddenPackagePaths = [
  /^e2e(?:\/|$)/,
  /^fixtures(?:\/|$)/,
  /^live(?:\/|$)/,
  /^scripts(?:\/|$)/,
  /^src(?:\/|$)/,
  /(?:^|\/)[^/]+\.test\.[cm]?[jt]s$/,
  /(?:^|\/)tsconfig(?:\.[^.]+)?\.json$/,
] as const;

export async function assertInstalledPackageContents(
  packageRoot: string
): Promise<void> {
  const rootEntries = (await readdir(packageRoot, { withFileTypes: true }))
    .map((entry) => entry.name)
    .sort();

  assertList("package root entries", rootEntries, expectedRootEntries);

  for (const path of await listPackagePaths(packageRoot)) {
    if (forbiddenPackagePaths.some((pattern) => pattern.test(path))) {
      throw new Error(`package contains private file: ${path}`);
    }
  }
}

async function listPackagePaths(root: string): Promise<string[]> {
  const paths: string[] = [];
  const pending: Array<{ absolute: string; relative: string }> = [
    { absolute: root, relative: "" },
  ];

  while (pending.length > 0) {
    const current = pending.pop();

    if (current === undefined) {
      continue;
    }

    for (const entry of await readdir(current.absolute, {
      withFileTypes: true,
    })) {
      const relativePath =
        current.relative === ""
          ? entry.name
          : `${current.relative}/${entry.name}`;

      paths.push(relativePath);

      if (entry.isDirectory()) {
        pending.push({
          absolute: join(current.absolute, entry.name),
          relative: relativePath,
        });
      }
    }
  }

  return paths.sort();
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
