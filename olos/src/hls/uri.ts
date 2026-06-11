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

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }

  return false;
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
