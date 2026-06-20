import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface DirectoryWalkEntry {
  absolutePath: string;
  isDirectory: boolean;
  isFile: boolean;
  relativePath: string;
}

export async function listDirectoryEntries(
  root: string
): Promise<DirectoryWalkEntry[]> {
  const entries: DirectoryWalkEntry[] = [];
  const pending: Array<{ absolutePath: string; relativePath: string }> = [
    { absolutePath: root, relativePath: "" },
  ];

  while (pending.length > 0) {
    const current = pending.pop();

    if (current === undefined) {
      continue;
    }

    for (const entry of await readdir(current.absolutePath, {
      withFileTypes: true,
    })) {
      const relativePath =
        current.relativePath === ""
          ? entry.name
          : `${current.relativePath}/${entry.name}`;
      const absolutePath = join(current.absolutePath, entry.name);

      entries.push({
        absolutePath,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        relativePath,
      });

      if (entry.isDirectory()) {
        pending.push({ absolutePath, relativePath });
      }
    }
  }

  return entries.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}
