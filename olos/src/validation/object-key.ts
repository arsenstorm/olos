import { hasControlCharacter, hasQueryOrFragment } from "./fields";

// Keys are internal object names, so traversal, query/fragment, control
// chars, and absolute/empty keys are rejected before any storage use. Core
// imposes no extension rule; profiles (e.g. olos/media) may layer their own.
export function isSafeObjectKey(value: unknown): value is string {
  return typeof value === "string" && safeObjectKeyError(value) === undefined;
}

export function assertSafeObjectKey(
  value: unknown,
  name: string
): asserts value is string {
  const error = safeObjectKeyError(value);

  if (error !== undefined) {
    throw new Error(`${name} ${error}`);
  }
}

function safeObjectKeyError(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return "must be a non-empty string";
  }

  if (hasUnsafeRelativeObjectKeyShape(value)) {
    return "must be a safe relative object key";
  }

  if (hasControlCharacter(value)) {
    return "must not contain control characters";
  }

  if (hasQueryOrFragment(value)) {
    return "must not contain query strings or fragments";
  }
}

function hasUnsafeRelativeObjectKeyShape(value: string): boolean {
  return hasUnsafeObjectKeyBoundary(value) || hasUnsafeObjectKeySegment(value);
}

function hasUnsafeObjectKeyBoundary(value: string): boolean {
  return value.startsWith("/") || value.endsWith("/");
}

function hasUnsafeObjectKeySegment(value: string): boolean {
  return value.split("/").some(isUnsafeObjectKeySegment);
}

function isUnsafeObjectKeySegment(segment: string): boolean {
  return segment === "" || segment === "." || segment === "..";
}
