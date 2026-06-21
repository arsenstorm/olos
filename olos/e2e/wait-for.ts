export interface WaitForOptions {
  attempts?: number;
  intervalMs?: number;
  message?: string;
}

export async function waitFor(
  condition: () => boolean,
  options: WaitForOptions = {}
): Promise<void> {
  const {
    attempts = 1000,
    intervalMs = 1,
    message = "condition was not met",
  } = options;
  let attempt = 0;

  while (attempt < attempts && !condition()) {
    attempt += 1;

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  if (!condition()) {
    throw new Error(message);
  }
}
