import { expect, test } from "bun:test";
import { runCommand, runCommandAndCapture } from "./script-runner";

test("runCommand returns a successful exit code", async () => {
  await expect(
    runCommand(process.execPath, ["--eval", "process.exit(0)"])
  ).resolves.toBe(0);
});

test("runCommand can return a failing exit code without rejecting", async () => {
  await expect(
    runCommand(process.execPath, ["--eval", "process.exit(7)"], {
      reject: false,
    })
  ).resolves.toBe(7);
});

test("runCommand rejects failing commands by default", async () => {
  await expect(
    runCommand(process.execPath, ["--eval", "process.exit(7)"])
  ).rejects.toThrow("exited with 7");
});

test("runCommandAndCapture returns stdout", async () => {
  await expect(
    runCommandAndCapture(
      process.execPath,
      ["--eval", 'process.stdout.write("captured-output")'],
      {
        forwardOutput: false,
      }
    )
  ).resolves.toContain("captured-output");
});
