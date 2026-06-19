export function assertPositiveExpiresInSeconds(value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("expiresInSeconds must be a positive number");
  }
}
