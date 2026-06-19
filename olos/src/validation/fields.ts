import { isNonNegativeInteger, isUrlSafeIdentifier } from "./ids";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  if (!Number.isInteger(value[field]) || Number(value[field]) <= 0) {
    throw new Error(`${name}.${field} must be a positive integer`);
  }
}

export function assertPositiveNumberField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  if (
    typeof value[field] !== "number" ||
    !Number.isFinite(value[field]) ||
    value[field] <= 0
  ) {
    throw new Error(`${name}.${field} must be a positive number`);
  }
}

export function nonNegativeNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }

  return value;
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
): void {
  if (!allowed.includes(value[field] as T[number])) {
    throw new Error(`${name}.${field} must be one of: ${allowed.join(", ")}`);
  }
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
