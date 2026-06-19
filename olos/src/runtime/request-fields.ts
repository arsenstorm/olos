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

export function booleanField(
  value: Record<string, unknown>,
  field: string
): boolean {
  if (typeof value[field] !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }

  return value[field];
}

export function nonNegativeNumberField(
  value: Record<string, unknown>,
  field: string
): number {
  const number = numberField(value, field);

  if (number < 0) {
    throw new Error(`${field} must be a non-negative number`);
  }

  return number;
}

export function nonNegativeIntegerField(
  value: Record<string, unknown>,
  field: string
): number {
  const number = numberField(value, field);

  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }

  return number;
}

export function positiveIntegerField(
  value: Record<string, unknown>,
  field: string
): number {
  const number = numberField(value, field);

  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }

  return number;
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

export function timestampMs(value: string, name: string): number {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    throw new Error(`${name} must be a valid timestamp`);
  }

  return timestamp;
}
