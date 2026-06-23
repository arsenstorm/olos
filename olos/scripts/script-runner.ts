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
    throw new Error(commandExitMessage(command, args, exitCode));
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
      commandExitMessage(command, args, exitCode, output.stdout, output.stderr)
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

function commandExitMessage(
  command: string,
  args: readonly string[],
  exitCode: number | null,
  stdout = "",
  stderr = ""
): string {
  const base = `${command} ${args.join(" ")} exited with ${exitCode}`;
  const details = capturedCommandOutputDetails({ stderr, stdout });

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
  if (value.length <= maxTailLength) {
    return value;
  }

  const marker = `${streamName} output truncated to the last ${maxTailLength} characters`;
  return `${marker}\n${value.slice(-maxTailLength)}`;
}
