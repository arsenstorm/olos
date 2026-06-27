import {
  assertNonNegativeInteger,
  assertPositiveInteger,
  assertUrlSafeIdentifier,
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

export function assertOnlyKnownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  name: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error(`${name} contains unknown property "${key}"`);
    }
  }
}

export function assertUrlSafeField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  assertFieldValue(value, field, name, assertUrlSafeIdentifier);
}

export function assertNonNegativeIntegerField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  assertFieldValue(value, field, name, assertNonNegativeInteger);
}

export function assertPositiveIntegerField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  assertFieldValue(value, field, name, assertPositiveInteger);
}

export function assertPositiveNumberField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  assertFieldValue(value, field, name, positiveNumber);
}

export function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }

  return value;
}

export function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }

  return value;
}

export function finiteNumber(value: unknown, name: string): number {
  if (!isFiniteNumber(value)) {
    throw new Error(`${name} must be a finite number`);
  }

  return value;
}

export function positiveNumber(value: unknown, name: string): number {
  if (!isFiniteNumber(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return value;
}

export function nonNegativeNumber(value: number, name: string): number {
  if (!isFiniteNumber(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }

  return value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function timestampString(value: unknown, name: string): string {
  const timestamp = stringValue(value, name);

  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`${name} must be a valid timestamp`);
  }

  return timestamp;
}

export function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);

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
    throw new Error(`${fieldName(name, field)} must be a non-empty string`);
  }
}

export function assertBooleanField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  assertFieldValue(value, field, name, booleanValue);
}

export function assertIsoDateField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  assertFieldValue(value, field, name, timestampString);
}

export function assertOneOfField<const T extends readonly string[]>(
  value: Record<string, unknown>,
  field: string,
  allowed: T,
  name: string
): T[number] {
  const fieldValue = value[field];

  if (!isAllowedString(fieldValue, allowed)) {
    throw new Error(
      `${fieldName(name, field)} must be one of: ${allowed.join(", ")}`
    );
  }

  return fieldValue;
}

function fieldName(name: string, field: string): string {
  return `${name}.${field}`;
}

function assertFieldValue(
  value: Record<string, unknown>,
  field: string,
  name: string,
  assertValue: (value: unknown, name: string) => unknown
): void {
  assertValue(value[field], fieldName(name, field));
}

interface AbsoluteHttpUrlOptions {
  allowQueryOrFragment?: boolean;
}

export function assertAbsoluteHttpUrl(
  value: unknown,
  name: string,
  options: AbsoluteHttpUrlOptions = {}
): void {
  parseAbsoluteHttpUrl(value, name, options);
}

export function parseAbsoluteHttpUrl(
  value: unknown,
  name: string,
  options: AbsoluteHttpUrlOptions = {}
): URL {
  const url = parseUrl(absoluteHttpUrlString(value, name), name);

  assertHttpUrlProtocol(url, name);
  assertUrlQueryAndFragmentPolicy(url, name, options);

  return url;
}

function absoluteHttpUrlString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }

  return value;
}

function parseUrl(value: string, name: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
}

function assertHttpUrlProtocol(url: URL, name: string): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
}

function assertUrlQueryAndFragmentPolicy(
  url: URL,
  name: string,
  options: AbsoluteHttpUrlOptions
): void {
  if (!options.allowQueryOrFragment && hasUrlQueryOrFragment(url)) {
    throw new Error(`${name} must not contain query strings or fragments`);
  }
}

function hasUrlQueryOrFragment(url: URL): boolean {
  return url.search.length > 0 || url.hash.length > 0;
}

export function isAllowedString<const T extends readonly string[]>(
  value: unknown,
  allowed: T
): value is T[number] {
  return typeof value === "string" && allowed.some((entry) => entry === value);
}
