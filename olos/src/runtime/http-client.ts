import { isRecord as requestFieldIsRecord } from "./request-fields";

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

export function requiredRecordPayload<T>(
  value: unknown,
  field: string,
  message: string
): T {
  return recordPayload<T>(requiredRecordField(value, field, message));
}

export function optionalRecordField(
  value: unknown,
  field: string
): Record<string, unknown> | undefined {
  if (!(isRecord(value) && isRecord(value[field]))) {
    return;
  }

  return value[field];
}

export function optionalRecordPayload<Field extends string, T>(
  value: unknown,
  field: Field
): Partial<Record<Field, T>> {
  const record = optionalRecordField(value, field);

  return record === undefined
    ? {}
    : ({ [field]: recordPayload<T>(record) } as Partial<Record<Field, T>>);
}

export function recordPayload<T>(value: Record<string, unknown>): T {
  return value as unknown as T;
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
