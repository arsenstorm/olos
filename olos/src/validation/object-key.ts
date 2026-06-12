export function isSafeObjectKey(value: unknown): value is string {
  return typeof value === "string" && safeObjectKeyError(value) === undefined;
}

export function assertSafeObjectKey(value: unknown, name: string): void {
  const error = safeObjectKeyError(value);

  if (error !== undefined) {
    throw new Error(`${name} ${error}`);
  }
}

function safeObjectKeyError(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return "must be a non-empty string";
  }

  if (value.startsWith("/") || value.endsWith("/")) {
    return "must be a safe relative object key";
  }

  if (hasControlCharacter(value)) {
    return "must not contain control characters";
  }

  if (
    value
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return "must be a safe relative object key";
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
