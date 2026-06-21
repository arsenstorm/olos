import { spawn } from "node:child_process";
import { packageRoot } from "./script-paths";

interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  forwardOutput?: boolean;
  reject?: boolean;
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
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stdout += text;
    if (options.forwardOutput !== false) {
      process.stdout.write(text);
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderr += text;
    if (options.forwardOutput !== false) {
      process.stderr.write(text);
    }
  });

  const exitCode = await waitForExit(child);

  if (options.reject !== false && exitCode !== 0) {
    throw new Error(
      commandExitMessage(command, args, exitCode, stdout, stderr)
    );
  }

  return `${stdout}\n${stderr}`;
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
  const details = [
    stdout && `stdout (tail):\n${truncateCommandOutput(stdout, "stdout")}`,
    stderr && `stderr (tail):\n${truncateCommandOutput(stderr, "stderr")}`,
  ]
    .filter(Boolean)
    .join("\n");

  return `${base}${details ? `\n${details}` : ""}`;
}

function truncateCommandOutput(value: string, streamName: string): string {
  const maxTailLength = 1024;
  if (value.length <= maxTailLength) {
    return value;
  }

  const marker = `${streamName} output truncated to the last ${maxTailLength} characters`;
  return `${marker}\n${value.slice(-maxTailLength)}`;
}
