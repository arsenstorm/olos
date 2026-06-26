import { positiveNumber } from "../validation/fields";

const EXPIRES_IN_SECONDS_FIELD_NAME = "expiresInSeconds";

export function assertPositiveExpiresInSeconds(value: unknown): void {
  positiveNumber(value, EXPIRES_IN_SECONDS_FIELD_NAME);
}
