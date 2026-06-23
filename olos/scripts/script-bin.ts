import { access } from "node:fs/promises";
import { join } from "node:path";

export async function resolveWorkspaceBin(
  name: string,
  roots: readonly string[]
): Promise<string> {
  for (const root of roots) {
    const candidate = workspaceBinPath(root, name);

    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `${name} binary not found in package or workspace node_modules`
  );
}

function workspaceBinPath(root: string, name: string): string {
  return join(root, "node_modules", ".bin", name);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
