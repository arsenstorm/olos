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
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (condition()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `${message} after ${attempts} attempts at ${intervalMs}ms intervals`
  );
}
