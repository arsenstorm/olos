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

export function optionalStringField<Field extends string>(
  value: Record<string, unknown>,
  field: Field
): Partial<Record<Field, string>> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: stringField(value, field) } as Partial<
    Record<Field, string>
  >;
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

export function optionalBooleanField<Field extends string>(
  value: Record<string, unknown>,
  field: Field
): Partial<Record<Field, boolean>> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: booleanField(value, field) } as Partial<
    Record<Field, boolean>
  >;
}

export function nonNegativeNumberField(
  value: Record<string, unknown>,
  field: string
): number {
  const number = numberField(value, field);

  return nonNegativeNumber(number, field);
}

export function optionalNonNegativeNumberField<Field extends string>(
  value: Record<string, unknown>,
  field: Field
): Partial<Record<Field, number>> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: nonNegativeNumberField(value, field) } as Partial<
    Record<Field, number>
  >;
}

export function nonNegativeNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }

  return value;
}

export function nonNegativeIntegerField(
  value: Record<string, unknown>,
  field: string
): number {
  const number = numberField(value, field);

  return nonNegativeInteger(number, field);
}

export function optionalNonNegativeIntegerField<Field extends string>(
  value: Record<string, unknown>,
  field: Field
): Partial<Record<Field, number>> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: nonNegativeIntegerField(value, field) } as Partial<
    Record<Field, number>
  >;
}

export function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return value;
}

export function positiveIntegerField(
  value: Record<string, unknown>,
  field: string
): number {
  const number = numberField(value, field);

  return positiveInteger(number, field);
}

export function optionalPositiveIntegerField<Field extends string>(
  value: Record<string, unknown>,
  field: Field
): Partial<Record<Field, number>> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: positiveIntegerField(value, field) } as Partial<
    Record<Field, number>
  >;
}

export function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

export function positiveNumberField(
  value: Record<string, unknown>,
  field: string
): number {
  const number = numberField(value, field);

  return positiveNumber(number, field);
}

export function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return value;
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

export function optionalTimestampField<Field extends string>(
  value: Record<string, unknown>,
  field: Field
): Partial<Record<Field, string>> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: timestampField(value, field) } as Partial<
    Record<Field, string>
  >;
}

export function timestampMs(value: string, name: string): number {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    throw new Error(`${name} must be a valid timestamp`);
  }

  return timestamp;
}
