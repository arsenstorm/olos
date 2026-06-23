import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import {
  assertInstalledPackageContents,
  packagePrivateRootEntries,
  packagePublicRootEntries,
} from "./package-contents";
import { packageExportSubpaths } from "./package-export-map";
import { expectedRuntimeExports } from "./public-surface";
import { withTemporaryDirectory } from "./test-temp-dir";

const forbiddenPublishedFileCases = [
  {
    label: "test files",
    pathSegments: ["dist", "index.test.js"],
  },
  {
    label: "nested test files",
    pathSegments: ["dist", "internal", "route.test.js"],
  },
  {
    label: "test declarations",
    pathSegments: ["dist", "index.test.d.ts"],
  },
  {
    label: "test helper files",
    pathSegments: ["dist", "test-client.test-helper.js"],
  },
  {
    label: "test helper declarations",
    pathSegments: ["dist", "test-client.test-helper.d.ts"],
  },
  {
    label: "spec files",
    pathSegments: ["dist", "index.spec.js"],
  },
  {
    label: "spec declarations",
    pathSegments: ["dist", "index.spec.d.ts"],
  },
  {
    contents: "{}\n",
    label: "TypeScript config files",
    pathSegments: ["dist", "tsconfig.build.json"],
  },
] as const;

describe("package contents verifier", () => {
  test("keeps public package roots aligned with export and smoke coverage", () => {
    expect([...packagePublicRootEntries].sort()).toEqual([
      "LICENSE",
      "README.md",
      "dist",
      "package.json",
    ]);
    expect(packageExportSubpaths(packageJson.exports)).not.toContain(
      "./scripts"
    );
    expect(Object.keys(expectedRuntimeExports)).not.toContain("olos/scripts");
  });

  test("accepts the intended package root", async () => {
    await withPackageRoot(async (root) => {
      await writeFile(join(root, "dist", "index.js"), "");
      await writeFile(join(root, "dist", "index.d.ts"), "");

      await expect(
        assertInstalledPackageContents(root)
      ).resolves.toBeUndefined();
    });
  });

  for (const privateRoot of packagePrivateRootEntries) {
    test(`rejects private ${privateRoot} roots`, async () => {
      await withPackageRoot(async (root) => {
        await mkdir(join(root, privateRoot));
        await writeFile(join(root, privateRoot, "fixture.txt"), "");

        await expect(assertInstalledPackageContents(root)).rejects.toThrow(
          "package root entries mismatch"
        );
      });
    });
  }

  for (const forbiddenFile of forbiddenPublishedFileCases) {
    test(`rejects ${forbiddenFile.label} inside published roots`, async () => {
      await withPackageRoot(async (root) => {
        const filePath = join(root, ...forbiddenFile.pathSegments);
        const relativePath = forbiddenFile.pathSegments.join("/");

        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, forbiddenFile.contents ?? "");

        await expect(assertInstalledPackageContents(root)).rejects.toThrow(
          `package contains private file: ${relativePath}`
        );
      });
    });
  }
});

async function withPackageRoot(
  run: (root: string) => Promise<void>
): Promise<void> {
  await withTemporaryDirectory("olos-package-contents-", async (root) => {
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "LICENSE"), "");
    await writeFile(join(root, "README.md"), "");
    await writeFile(join(root, "package.json"), "{}\n");

    await run(root);
  });
}
