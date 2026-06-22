import { hasControlCharacter } from "./fields";

// Delivery URL policy for externally visible manifest and media references.
// The project permits only absolute HTTP(S) URLs or safe relative paths,
// and forbids query strings, fragments, and control characters.
export function assertSafeDeliveryUrl(value: unknown, name: string): void {
  const deliveryUrl = deliveryUrlString(value, name);

  assertDeliveryUrlHasNoControlCharacters(deliveryUrl, name);
  assertDeliveryUrlHasNoQueryOrFragment(deliveryUrl, name);

  if (isAllowedDeliveryReference(deliveryUrl)) {
    return;
  }

  throw new Error(
    `${name} must be an absolute HTTP(S) URL or safe relative path`
  );
}

function deliveryUrlString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value;
}

function assertDeliveryUrlHasNoControlCharacters(
  value: string,
  name: string
): void {
  if (hasControlCharacter(value)) {
    throw new Error(`${name} must not contain control characters`);
  }
}

function assertDeliveryUrlHasNoQueryOrFragment(
  value: string,
  name: string
): void {
  if (value.includes("?") || value.includes("#")) {
    throw new Error(`${name} must not contain query strings or fragments`);
  }
}

function isAllowedDeliveryReference(value: string): boolean {
  if (value.startsWith("/") && isSafeRelativePath(value)) {
    return true;
  }

  return parseAbsoluteUrl(value) !== undefined;
}

function isSafeRelativePath(value: string): boolean {
  if (value.startsWith("//") || value.includes("//")) {
    return false;
  }

  const parts = value.split("/");
  return parts.every((part) => part !== "." && part !== "..");
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
