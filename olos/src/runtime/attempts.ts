export function positiveAttempts(value: number | undefined): number {
  const attempts = value ?? 2;

  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("maxAttempts must be a positive integer");
  }

  return attempts;
}
