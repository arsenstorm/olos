import { describe, expect, test } from "bun:test";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withTemporaryDirectory } from "./test-temp-dir";

describe("temporary directory test helper", () => {
  test("returns the callback result", async () => {
    await expect(
      withTemporaryDirectory("olos-temp-dir-", async (directory) => {
        await writeFile(join(directory, "marker.txt"), "");

        return "ok";
      })
    ).resolves.toBe("ok");
  });

  test("removes the temporary directory when the callback throws", async () => {
    let createdDirectory = "";

    await expect(
      withTemporaryDirectory("olos-temp-dir-error-", async (directory) => {
        createdDirectory = directory;
        await writeFile(join(directory, "marker.txt"), "");

        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    await expect(stat(createdDirectory)).rejects.toThrow();
  });
});
