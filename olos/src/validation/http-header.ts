import { isRecord } from "./fields";

const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function isHttpHeaderName(value: string): boolean {
  return HTTP_HEADER_NAME_PATTERN.test(value);
}

export function isHttpHeaderStringMap(
  value: unknown
): value is Record<string, string> {
  return isHttpHeaderMap(value, (entry) => typeof entry === "string");
}

export function isOptionalHttpHeaderStringMap(
  value: unknown
): value is Record<string, string | undefined> {
  return isHttpHeaderMap(
    value,
    (entry) => typeof entry === "string" || entry === undefined
  );
}

function isHttpHeaderMap(
  value: unknown,
  isValidEntry: (entry: unknown) => boolean
): boolean {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, entry]) => isHttpHeaderName(key) && isValidEntry(entry)
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
