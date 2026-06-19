import { positiveNumber } from "../validation/fields";

export function assertPositiveExpiresInSeconds(value: unknown): void {
  positiveNumber(value, "expiresInSeconds");
}
