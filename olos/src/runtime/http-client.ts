import { recordValue } from "../validation/fields";
import { optionalField } from "./request-fields";

export type RuntimeHttpFetch = (
  input: Request | URL | string,
  init?: RequestInit
) => Promise<Response>;

export interface RuntimeHttpClientSource {
  fetch?: RuntimeHttpFetch;
}

export function jsonPost(body: unknown): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  };
}

export function normalizedBaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

export function fetchFor(options: RuntimeHttpClientSource): RuntimeHttpFetch {
  return options.fetch ?? fetch;
}

export function requiredRecordField(
  value: unknown,
  field: string,
  message: string
): Record<string, unknown> {
  const record = optionalRecordField(value, field);

  if (record === undefined) {
    throw new Error(message);
  }

  return record;
}

export function requiredRecord(
  value: unknown,
  message: string
): Record<string, unknown> {
  const record = recordValue(value);

  if (record === undefined) {
    throw new Error(message);
  }

  return record;
}

type RecordPayloadAssertion<T> = (value: unknown) => asserts value is T;

export function requiredRecordPayload<T>(
  value: unknown,
  field: string,
  message: string,
  assert: RecordPayloadAssertion<T>
): T {
  return requiredParsedPayload<T>(value, field, message, (v) => {
    assert(v);
    return v;
  });
}

export function requiredArrayField(
  value: unknown,
  field: string,
  message: string
): unknown[] {
  const fieldValue = recordFieldValue(value, field);

  if (!Array.isArray(fieldValue)) {
    throw new Error(message);
  }

  return fieldValue;
}

export function optionalRecordField(
  value: unknown,
  field: string
): Record<string, unknown> | undefined {
  return recordValue(recordFieldValue(value, field));
}

export function requiredStringField(
  value: unknown,
  field: string,
  message: string
): string {
  const fieldValue = recordFieldValue(value, field);

  if (typeof fieldValue !== "string") {
    throw new Error(message);
  }

  return fieldValue;
}

function recordFieldValue(value: unknown, field: string): unknown {
  return recordValue(value)?.[field];
}

/**
 * Parses an optional record field with a tolerant `parseX` parser, which
 * returns a pruned copy of the record rather than asserting it in place.
 */
export function optionalParsedPayload<Field extends string, T>(
  value: unknown,
  field: Field,
  parse: (value: unknown) => T
): Partial<Record<Field, T>> {
  const record = optionalRecordField(value, field);

  return record === undefined ? {} : optionalField(field, parse(record));
}

/**
 * `requiredRecordPayload` for tolerant `parseX` parsers, which return a
 * pruned copy of the record rather than asserting it in place.
 */
export function requiredParsedPayload<T>(
  value: unknown,
  field: string,
  message: string,
  parse: (value: unknown) => T
): T {
  return parse(requiredRecordField(value, field, message));
}

export async function responseBody(response: Response): Promise<unknown> {
  const text = await responseText(response);

  if (text.length === 0) {
    return;
  }

  return parseResponseText(text);
}

async function responseText(response: Response): Promise<string> {
  return await response.clone().text();
}

function parseResponseText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
