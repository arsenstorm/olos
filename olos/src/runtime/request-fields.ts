import { assertUrlSafeIdentifier } from "../validation/ids";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(
  value: Record<string, unknown>,
  field: string
): string {
  if (typeof value[field] !== "string") {
    throw new Error(`${field} must be a string`);
  }

  return value[field];
}

export function urlSafeIdentifierField(
  value: Record<string, unknown>,
  field: string
): string {
  assertUrlSafeIdentifier(value[field], field);

  return value[field];
}

export function numberField(
  value: Record<string, unknown>,
  field: string
): number {
  if (typeof value[field] !== "number" || !Number.isFinite(value[field])) {
    throw new Error(`${field} must be a finite number`);
  }

  return value[field];
}

export function positiveNumberField(
  value: Record<string, unknown>,
  field: string
): number {
  const number = numberField(value, field);

  if (number <= 0) {
    throw new Error(`${field} must be a positive number`);
  }

  return number;
}

export function timestampField(
  value: Record<string, unknown>,
  field: string
): string {
  const timestamp = stringField(value, field);

  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`${field} must be a valid timestamp`);
  }

  return timestamp;
}
