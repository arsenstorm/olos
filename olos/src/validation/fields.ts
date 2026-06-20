import {
  assertPositiveInteger,
  isNonNegativeInteger,
  isUrlSafeIdentifier,
} from "./ids";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function recordValue(
  value: unknown
): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function nonEmptyArray<T = unknown>(value: unknown, name: string): T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${name} must be a non-empty array`);
  }

  return value as T[];
}

export function assertUrlSafeField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  if (!isUrlSafeIdentifier(value[field])) {
    throw new Error(`${name}.${field} must be a non-empty URL-safe identifier`);
  }
}

export function assertNonNegativeIntegerField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  if (!isNonNegativeInteger(value[field])) {
    throw new Error(`${name}.${field} must be a non-negative integer`);
  }
}

export function assertPositiveIntegerField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  assertPositiveInteger(value[field], `${name}.${field}`);
}

export function assertPositiveNumberField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  positiveNumber(value[field], `${name}.${field}`);
}

export function positiveNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return value;
}

export function nonNegativeNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }

  return value;
}

export function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }

  return false;
}

export function assertNonEmptyStringField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  if (typeof value[field] !== "string" || value[field].length === 0) {
    throw new Error(`${name}.${field} must be a non-empty string`);
  }
}

export function assertBooleanField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  if (typeof value[field] !== "boolean") {
    throw new Error(`${name}.${field} must be a boolean`);
  }
}

export function assertIsoDateField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  if (
    typeof value[field] !== "string" ||
    Number.isNaN(Date.parse(value[field]))
  ) {
    throw new Error(`${name}.${field} must be a valid timestamp`);
  }
}

export function assertOneOfField<const T extends readonly string[]>(
  value: Record<string, unknown>,
  field: string,
  allowed: T,
  name: string
): T[number] {
  const fieldValue = value[field];

  if (!isAllowedString(fieldValue, allowed)) {
    throw new Error(`${name}.${field} must be one of: ${allowed.join(", ")}`);
  }

  return fieldValue;
}

export function assertAbsoluteHttpUrl(value: unknown, name: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }

  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`${name} must not contain query strings or fragments`);
  }
}

export function isAllowedString<const T extends readonly string[]>(
  value: unknown,
  allowed: T
): value is T[number] {
  return typeof value === "string" && allowed.some((entry) => entry === value);
}
