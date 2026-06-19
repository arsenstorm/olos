const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function isHttpHeaderName(value: string): boolean {
  return HTTP_HEADER_NAME_PATTERN.test(value);
}

export function isHttpHeaderStringMap(
  value: unknown
): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, entry]) => isHttpHeaderName(key) && typeof entry === "string"
    )
  );
}

export function isOptionalHttpHeaderStringMap(
  value: unknown
): value is Record<string, string | undefined> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, entry]) =>
        isHttpHeaderName(key) &&
        (typeof entry === "string" || entry === undefined)
    )
  );
}

export function assertHttpHeaderStringMap(
  value: unknown,
  name: string
): asserts value is Record<string, string> {
  if (!isHttpHeaderStringMap(value)) {
    throw new Error(`${name} must be a string map`);
  }
}

export const HTTP_HEADER_NAME_SCHEMA_PATTERN =
  "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+$";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
