import {
  assertNonNegativeInteger,
  assertPositiveInteger,
  assertUrlSafeIdentifier,
} from "./ids";

// RFC 3339 date-time, strictly: full-date, "T"/"t" separator, full-time, and
// a "Z"/"z" or "±hh:mm" offset. Deliberately narrower than the RFC's ABNF
// where epoch milliseconds cannot represent the value: leap seconds (second
// 60) and hour 24 are rejected, as are the space separator and colon-less
// offsets some producers emit. The year/month/day captures feed the calendar
// check in `timestampString`; the same pattern constrains the JSON schemas so
// schema and validator agree.
export const RFC3339_TIMESTAMP_SCHEMA_PATTERN =
  "^(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])[Tt]" +
  "(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?" +
  "(?:[Zz]|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$";

const RFC3339_TIMESTAMP_PATTERN = new RegExp(RFC3339_TIMESTAMP_SCHEMA_PATTERN);

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

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

/**
 * Declares how a nested field of a `KnownFieldsShape` recurses: a single
 * `object`, an `array` of objects, or a `map` whose every value is an
 * object — each pruned against the given `shape`.
 */
export type KnownNestedFieldShape =
  | { kind: "array"; shape: KnownFieldsShape }
  | { kind: "map"; shape: KnownFieldsShape }
  | { kind: "object"; shape: KnownFieldsShape };

/**
 * Recursive description of a document's known fields, used by
 * `pruneUnknownFields` to strip unknown properties on the tolerant read
 * path. `fields` lists every allowed key; `nested` names the fields whose
 * values are pruned recursively.
 */
export interface KnownFieldsShape {
  fields: readonly string[];
  nested?: Readonly<Record<string, KnownNestedFieldShape>>;
}

/**
 * Return a fresh copy of `value` with any properties not listed in `shape`
 * removed, recursing into the declared `nested` fields. Non-record inputs
 * (and nested values of the wrong shape) are returned as-is so the closed
 * validator that runs afterwards reports its usual error. This is the
 * tolerant-reader half of the read path (spec §11.2): consumers prune
 * unknown fields, then run the unchanged closed validator on the clone.
 */
export function pruneUnknownFields(
  value: unknown,
  shape: KnownFieldsShape
): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const pruned: Record<string, unknown> = {};

  for (const field of shape.fields) {
    if (field in value) {
      pruned[field] = pruneNestedField(value[field], shape.nested?.[field]);
    }
  }

  return pruned;
}

function pruneNestedField(
  value: unknown,
  nested: KnownNestedFieldShape | undefined
): unknown {
  if (nested === undefined) {
    return value;
  }

  if (nested.kind === "array") {
    return Array.isArray(value)
      ? value.map((entry) => pruneUnknownFields(entry, nested.shape))
      : value;
  }

  if (nested.kind === "map") {
    return isRecord(value) ? pruneRecordValues(value, nested.shape) : value;
  }

  return pruneUnknownFields(value, nested.shape);
}

function pruneRecordValues(
  value: Record<string, unknown>,
  shape: KnownFieldsShape
): Record<string, unknown> {
  const pruned: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    pruned[key] = pruneUnknownFields(entry, shape);
  }

  return pruned;
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
  const match = RFC3339_TIMESTAMP_PATTERN.exec(timestamp);

  if (match === null || !isCalendarDate(match)) {
    throw new Error(`${name} must be a valid timestamp`);
  }

  return timestamp;
}

// The pattern caps days at 31; this rejects the remainder (Feb 30, Apr 31,
// Feb 29 outside leap years) without Date.parse, which silently rolls such
// dates into the following month.
function isCalendarDate(match: RegExpExecArray): boolean {
  const day = Number(match[3]);

  return day <= daysInMonth(Number(match[1]), Number(match[2]));
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Converts a timestamp string to epoch milliseconds. Deliberately lenient —
 * `Date.parse` accepts more than RFC 3339 (e.g. HTTP dates). Use for strings
 * already validated by `timestampString` and for normalization sites that
 * accept provider formats such as `Last-Modified` headers.
 */
export function timestampMs(value: string, name: string): number {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
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
