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

test("runCommandAndCapture can return captured output from failing commands", async () => {
  await expect(
    runCommandAndCapture(
      process.execPath,
      [
        "--eval",
        'process.stdout.write("captured-stdout"); process.stderr.write("captured-stderr"); process.exit(7);',
      ],
      {
        forwardOutput: false,
        reject: false,
      }
    )
  ).resolves.toContain("captured-stderr");
});

test("runCommandAndCapture includes captured output in failure message", async () => {
  await expect(
    runCommandAndCapture(
      process.execPath,
      [
        "--eval",
        'console.error("captured-stderr"); process.stdout.write("captured-stdout"); process.exit(7);',
      ],
      {
        forwardOutput: false,
      }
    )
  ).rejects.toThrow("captured-stderr");

  await expect(
    runCommandAndCapture(
      process.execPath,
      ["--eval", 'process.stdout.write("captured-stdout"); process.exit(7);'],
      {
        forwardOutput: false,
      }
    )
  ).rejects.toThrow("captured-stdout");
});

test("runCommandAndCapture truncates captured output in failure message", async () => {
  const longOutput =
    'process.stdout.write("a".repeat(2000)); process.stderr.write("b".repeat(2000)); process.exit(7);';

  await expect(
    runCommandAndCapture(process.execPath, ["--eval", longOutput], {
      forwardOutput: false,
    })
  ).rejects.toThrow("output truncated to the last 1024 characters");
});
