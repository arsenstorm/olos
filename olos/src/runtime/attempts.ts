import { positiveInteger } from "./request-fields";

export function positiveAttempts(value: number | undefined): number {
  const attempts = value ?? 2;

  return positiveInteger(attempts, "maxAttempts");
}
