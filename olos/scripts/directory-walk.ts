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

    // biome-ignore lint/performance/noAwaitInLoops: each iteration reads a directory the previous iteration pushed onto `pending`.
    const children = await listChildEntries(current);
    entries.push(...children);
    pending.push(...children.filter((child) => child.isDirectory));
  }

  return entries.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

async function listChildEntries(
  parent: PendingDirectory
): Promise<DirectoryWalkEntry[]> {
  const entries = await readdir(parent.absolutePath, { withFileTypes: true });

  return entries.map((entry) =>
    createDirectoryWalkEntry(parent, entry.name, {
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    })
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
