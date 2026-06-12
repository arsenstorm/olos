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

  if (value.startsWith("/") && !value.startsWith("//")) {
    return;
  }

  const url = parseAbsoluteUrl(value);

  if (!url) {
    throw new Error(
      `${name} must be an absolute HTTP(S) URL or safe relative path`
    );
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
