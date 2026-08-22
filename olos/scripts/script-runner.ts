import { spawn } from "node:child_process";
import { packageRoot } from "./script-paths";

interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  forwardOutput?: boolean;
  reject?: boolean;
}

interface CapturedCommandOutput {
  stderr: string;
  stdout: string;
}

export async function runCommand(
  command: string,
  args: readonly string[],
  options: RunCommandOptions = {}
): Promise<number | null> {
  const exitCode = await spawnAndWait(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: "inherit",
  });

  if (options.reject !== false && exitCode !== 0) {
    throw new Error(commandExitMessage({ args, command, exitCode }));
  }

  return exitCode;
}

export async function runCommandAndCapture(
  command: string,
  args: readonly string[],
  options: RunCommandOptions = {}
): Promise<string> {
  const child = spawn(command, args, {
    cwd: options.cwd ?? packageRoot,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = emptyCapturedCommandOutput();

  child.stdout.on("data", (chunk: Buffer) => {
    captureCommandOutputChunk(output, "stdout", chunk, options);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    captureCommandOutputChunk(output, "stderr", chunk, options);
  });

  const exitCode = await waitForExit(child);

  if (options.reject !== false && exitCode !== 0) {
    throw new Error(
      commandExitMessage({
        args,
        command,
        exitCode,
        stderr: output.stderr,
        stdout: output.stdout,
      })
    );
  }

  return `${output.stdout}\n${output.stderr}`;
}

function emptyCapturedCommandOutput(): CapturedCommandOutput {
  return {
    stderr: "",
    stdout: "",
  };
}

function captureCommandOutputChunk(
  output: CapturedCommandOutput,
  streamName: keyof CapturedCommandOutput,
  chunk: Buffer,
  options: RunCommandOptions
): void {
  const text = chunk.toString();
  output[streamName] += text;

  if (options.forwardOutput !== false) {
    forwardedOutputStream(streamName).write(text);
  }
}

function forwardedOutputStream(
  streamName: keyof CapturedCommandOutput
): NodeJS.WriteStream {
  return streamName === "stdout" ? process.stdout : process.stderr;
}

function spawnAndWait(
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio: "inherit";
  }
): Promise<number | null> {
  return waitForExit(
    spawn(command, args, {
      cwd: options.cwd ?? packageRoot,
      env: options.env,
      stdio: options.stdio,
    })
  );
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
}

interface CommandExit {
  args: readonly string[];
  command: string;
  exitCode: number | null;
  stderr?: string;
  stdout?: string;
}

function commandExitMessage(exit: CommandExit): string {
  const base = `${exit.command} ${exit.args.join(" ")} exited with ${exit.exitCode}`;
  const details = capturedCommandOutputDetails({
    stderr: exit.stderr ?? "",
    stdout: exit.stdout ?? "",
  });

  return `${base}${details ? `\n${details}` : ""}`;
}

function capturedCommandOutputDetails(output: CapturedCommandOutput): string {
  return [
    capturedCommandStreamDetails(output.stdout, "stdout"),
    capturedCommandStreamDetails(output.stderr, "stderr"),
  ]
    .filter((details) => details.length > 0)
    .join("\n");
}

function capturedCommandStreamDetails(
  output: string,
  streamName: keyof CapturedCommandOutput
): string {
  return output.length === 0
    ? ""
    : `${streamName} (tail):\n${truncateCommandOutput(output, streamName)}`;
}

function truncateCommandOutput(value: string, streamName: string): string {
  const maxTailLength = 1024;
  const plainValue = stripAnsi(value);

  if (plainValue.length <= maxTailLength) {
    return plainValue;
  }

  const marker = `${streamName} output truncated to the last ${maxTailLength} characters`;
  return `${marker}\n${plainValue.slice(-maxTailLength)}`;
}

function stripAnsi(value: string): string {
  let result = "";
  let index = 0;

  while (index < value.length) {
    if (value.charCodeAt(index) !== 0x1b || value[index + 1] !== "[") {
      result += value[index];
      index += 1;
      continue;
    }

    index = csiSequenceEnd(value, index + 2);
  }

  return result;
}

/** Index just past the final byte (0x40-0x7e) of a CSI escape sequence. */
function csiSequenceEnd(value: string, start: number): number {
  let index = start;

  while (index < value.length) {
    const code = value.charCodeAt(index);
    index += 1;

    if (code >= 0x40 && code <= 0x7e) {
      return index;
    }
  }

  return index;
}
