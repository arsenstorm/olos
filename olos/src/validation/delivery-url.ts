import { hasControlCharacter } from "./fields";

export function assertSafeDeliveryUrl(value: unknown, name: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  if (hasControlCharacter(value)) {
    throw new Error(`${name} must not contain control characters`);
  }

  if (value.includes("?") || value.includes("#")) {
    throw new Error(`${name} must not contain query strings or fragments`);
  }

  if (value.startsWith("/") && isSafeRelativePath(value)) {
    return;
  }

  const url = parseAbsoluteUrl(value);

  if (!url) {
    throw new Error(
      `${name} must be an absolute HTTP(S) URL or safe relative path`
    );
  }
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
