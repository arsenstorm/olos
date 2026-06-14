const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function isHttpHeaderName(value: string): boolean {
  return HTTP_HEADER_NAME_PATTERN.test(value);
}

export const HTTP_HEADER_NAME_SCHEMA_PATTERN =
  "^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+$";
