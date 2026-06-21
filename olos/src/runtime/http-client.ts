import { optionalField } from "./optional-field";
import {
  recordValue,
  isRecord as requestFieldIsRecord,
} from "./request-fields";

export const isRecord = requestFieldIsRecord;

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
  return recordPayload<T>(requiredRecordField(value, field, message), assert);
}

export function requiredArrayField(
  value: unknown,
  field: string,
  message: string
): unknown[] {
  const fieldValue = recordValue(value)?.[field];

  if (!Array.isArray(fieldValue)) {
    throw new Error(message);
  }

  return fieldValue;
}

export function optionalRecordField(
  value: unknown,
  field: string
): Record<string, unknown> | undefined {
  return recordValue(recordValue(value)?.[field]);
}

export function requiredStringField(
  value: unknown,
  field: string,
  message: string
): string {
  const fieldValue = recordValue(value)?.[field];

  if (typeof fieldValue !== "string") {
    throw new Error(message);
  }

  return fieldValue;
}

export function optionalRecordPayload<Field extends string, T>(
  value: unknown,
  field: Field,
  assert: RecordPayloadAssertion<T>
): Partial<Record<Field, T>> {
  const record = optionalRecordField(value, field);

  return record === undefined
    ? {}
    : optionalField(field, recordPayload<T>(record, assert));
}

export function recordPayload<T>(
  value: Record<string, unknown>,
  assert: RecordPayloadAssertion<T>
): T {
  assert(value);
  return value;
}

export async function responseBody(response: Response): Promise<unknown> {
  const text = await response.clone().text();

  if (text.length === 0) {
    return;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
