import { hasControlCharacter } from "../validation/fields";

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
