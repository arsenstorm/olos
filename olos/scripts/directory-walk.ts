import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface DirectoryWalkEntry {
  absolutePath: string;
  isDirectory: boolean;
  isFile: boolean;
  relativePath: string;
}

interface PendingDirectory {
  absolutePath: string;
  relativePath: string;
}

export async function listDirectoryEntries(
  root: string
): Promise<DirectoryWalkEntry[]> {
  const entries: DirectoryWalkEntry[] = [];
  const pending: PendingDirectory[] = [
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
      const walkEntry = createDirectoryWalkEntry(current, entry.name, {
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
      });

      entries.push(walkEntry);

      if (entry.isDirectory()) {
        pending.push(walkEntry);
      }
    }
  }

  return entries.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

function createDirectoryWalkEntry(
  parent: PendingDirectory,
  name: string,
  kind: Pick<DirectoryWalkEntry, "isDirectory" | "isFile">
): DirectoryWalkEntry {
  return {
    absolutePath: join(parent.absolutePath, name),
    isDirectory: kind.isDirectory,
    isFile: kind.isFile,
    relativePath: childRelativePath(parent.relativePath, name),
  };
}

function childRelativePath(parentRelativePath: string, name: string): string {
  return parentRelativePath === "" ? name : `${parentRelativePath}/${name}`;
}
