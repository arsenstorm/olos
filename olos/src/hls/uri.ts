import { hasControlCharacter } from "../validation/fields";

// Media URI policy is distinct from object-key policy.
// HLS URIs can be safe relative paths or HTTPS URLs from an allow-list of
// media origins.
export const HLS_RELATIVE_REQUEST_BASE_URL = "https://olos.local";

export interface MediaUriPolicy {
  allowedMediaOrigins?: readonly string[];
}

export function assertSafeRelativePath(value: string, name: string): void {
  assertRelativePathShape(value, name);
  assertRelativePathHasNoQueryOrFragment(value, name);
}

export function assertSafeMediaUri(
  value: string,
  policy: MediaUriPolicy,
  name: string
): void {
  const mediaUri = mediaUriString(value, name);

  assertMediaUriHasNoControlCharacters(mediaUri, name);

  if (mediaUri.startsWith("/")) {
    assertSafeRelativePath(mediaUri, name);
    return;
  }

  assertAllowedAbsoluteMediaUri(mediaUri, policy, name);
}

function mediaUriString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value;
}

function assertMediaUriHasNoControlCharacters(
  value: string,
  name: string
): void {
  if (hasControlCharacter(value)) {
    throw new Error(`${name} must not contain control characters`);
  }
}

function assertRelativePathShape(value: string, name: string): void {
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

function assertRelativePathHasNoQueryOrFragment(
  value: string,
  name: string
): void {
  if (value.includes("?") || value.includes("#")) {
    throw new Error(`${name} must not contain query strings or fragments`);
  }
}

function assertAllowedAbsoluteMediaUri(
  value: string,
  policy: MediaUriPolicy,
  name: string
): void {
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
