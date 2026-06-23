import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatLargeFileReport, largeFileReport } from "./file-size-report";
import { withTemporaryDirectory } from "./test-temp-dir";

describe("file size report", () => {
  test("reports source files above the advisory line threshold", async () => {
    await withTemporaryDirectory("olos-file-size-report-", async (root) => {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "small.ts"), "one\n");
      await writeFile(join(root, "src", "large.ts"), "one\ntwo\nthree\n");

      expect(await largeFileReport({ maxLines: 2, root })).toEqual([
        {
          lines: 3,
          relativePath: "src/large.ts",
        },
      ]);
    });
  });

  test("ignores generated and dependency output", async () => {
    await withTemporaryDirectory("olos-file-size-report-", async (root) => {
      await mkdir(join(root, "dist"), { recursive: true });
      await mkdir(join(root, "node_modules", "dep"), { recursive: true });
      await writeFile(join(root, "dist", "large.ts"), "one\ntwo\nthree\n");
      await writeFile(
        join(root, "node_modules", "dep", "large.ts"),
        "one\ntwo\nthree\n"
      );

      expect(await largeFileReport({ maxLines: 2, root })).toEqual([]);
    });
  });

  test("sorts advisory entries by line count then path", async () => {
    await withTemporaryDirectory("olos-file-size-report-", async (root) => {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "b.ts"), "one\ntwo\nthree\n");
      await writeFile(join(root, "src", "a.ts"), "one\ntwo\nthree\n");
      await writeFile(
        join(root, "src", "largest.ts"),
        "one\ntwo\nthree\nfour\n"
      );

      expect(await largeFileReport({ maxLines: 2, root })).toEqual([
        {
          lines: 4,
          relativePath: "src/largest.ts",
        },
        {
          lines: 3,
          relativePath: "src/a.ts",
        },
        {
          lines: 3,
          relativePath: "src/b.ts",
        },
      ]);
    });
  });

  test("formats an advisory report without failing policy language", () => {
    expect(
      formatLargeFileReport(
        [
          {
            lines: 1201,
            relativePath: "src/s3/http.test.ts",
          },
        ],
        1000
      )
    ).toBe(
      [
        "Advisory: 1 source files exceed 1000 lines.",
        "Consider splitting these when touching related code:",
        "- src/s3/http.test.ts: 1201 lines",
      ].join("\n")
    );
  });

  test("formats an empty report", () => {
    expect(formatLargeFileReport([], 1000)).toBe(
      "No source files exceed 1000 lines."
    );
  });
});
