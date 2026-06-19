import { hasControlCharacter } from "../validation/fields";

export interface MediaUriPolicy {
  allowedMediaOrigins?: readonly string[];
}

export function assertSafeRelativePath(value: string, name: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    hasControlCharacter(value)
  ) {
    throw new Error(`${name} must be a safe relative path`);
  }

  if (value.includes("?") || value.includes("#")) {
    throw new Error(`${name} must not contain query strings or fragments`);
  }
}

export function assertSafeMediaUri(
  value: string,
  policy: MediaUriPolicy,
  name: string
): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  if (hasControlCharacter(value)) {
    throw new Error(`${name} must not contain control characters`);
  }

  if (value.startsWith("/")) {
    assertSafeRelativePath(value, name);
    return;
  }

  const url = parseAbsoluteUrl(value);

  if (!url) {
    throw new Error(
      `${name} must be a safe relative path or allowed absolute URL`
    );
  }

  if (url.protocol !== "https:") {
    throw new Error(`${name} must use https`);
  }

  const allowedOrigins = policy.allowedMediaOrigins ?? [];

  if (!allowedOrigins.includes(url.origin)) {
    throw new Error(`${name} origin is not allowed`);
  }
}

function parseAbsoluteUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url
      : undefined;
  } catch {
    return;
  }
}
