import { hasControlCharacter } from "../validation/fields";

// Route/path policy is for URI/path parameters used by runtime and tests.
// It rejects traversal and malformed segments; this is separate from storage
// object-key validation.
const URL_SCHEME_PREFIX = /^[A-Za-z][A-Za-z\d+.-]*:/;

export function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}

export function normalizedSafeRelativePath(
  value: string,
  name: string
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("//") ||
    value.includes("?") ||
    value.includes("#") ||
    hasControlCharacter(value) ||
    URL_SCHEME_PREFIX.test(value)
  ) {
    throw new Error(`${name} must be a safe relative path`);
  }

  const path = trimSlashes(value);

  if (
    path.length === 0 ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`${name} must be a safe relative path`);
  }

  return path;
}

export function assertSafePath(value: string, name: string): void {
  assertNoQueryOrFragment(value, name);

  if (isUnsafeRelativePath(value)) {
    throw new Error(`${name} must be a safe relative path`);
  }
}

function assertNoQueryOrFragment(value: string, name: string): void {
  if (value.includes("?") || value.includes("#")) {
    throw new Error(`${name} must not contain query strings or fragments`);
  }
}

function isUnsafeRelativePath(value: string): boolean {
  return (
    value.length === 0 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    hasUnsafePathSegment(value)
  );
}

function hasUnsafePathSegment(value: string): boolean {
  return value
    .split("/")
    .some((segment) => segment === "" || segment === "." || segment === "..");
}

export function assertSafePathSegment(value: string, name: string): void {
  if (
    value.length === 0 ||
    value.includes("/") ||
    value.includes(".") ||
    value === "." ||
    value === ".."
  ) {
    throw new Error(`${name} must be a safe path segment without dots`);
  }
}
