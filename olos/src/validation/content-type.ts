const TOKEN = "[!#$%&'*+\\-.^_`|~0-9A-Za-z]+";
const QUOTED_STRING = '"[\\t !#-\\[\\]-~]*"';

export const CONTENT_TYPE_SCHEMA_PATTERN = `^${TOKEN}/${TOKEN}(?:; *${TOKEN}=(?:${TOKEN}|${QUOTED_STRING}))*$`;

const CONTENT_TYPE_PATTERN = new RegExp(CONTENT_TYPE_SCHEMA_PATTERN);

export function isContentType(value: unknown): value is string {
  return typeof value === "string" && CONTENT_TYPE_PATTERN.test(value);
}

export function assertContentType(value: unknown, name: string): void {
  if (!isContentType(value)) {
    throw new Error(`${name} must be a valid content type`);
  }
}
