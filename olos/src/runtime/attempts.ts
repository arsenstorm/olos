import { positiveInteger } from "./request-fields";

const DEFAULT_MAX_ATTEMPTS = 2;
const MAX_ATTEMPTS_FIELD_NAME = "maxAttempts";

export function positiveAttempts(value: number | undefined): number {
  const attempts = value ?? DEFAULT_MAX_ATTEMPTS;

  return positiveInteger(attempts, MAX_ATTEMPTS_FIELD_NAME);
}
