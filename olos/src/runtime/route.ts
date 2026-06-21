import { hasControlCharacter } from "../validation/fields";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { errorMessage } from "./errors";
import { trimSlashes } from "./path";

export function routeParts(
  pathname: string,
  routePath: string
): "invalid" | readonly string[] | undefined {
  const normalized = normalizePath(routePath);

  if (pathname !== normalized && !pathname.startsWith(`${normalized}/`)) {
    return;
  }

  try {
    return pathname
      .slice(normalized.length)
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
  } catch {
    return "invalid";
  }
}

export function routeIdentifierError(
  value: string | undefined,
  name: string,
  fallbackMessage: string
): string | undefined {
  try {
    assertUrlSafeIdentifier(value, name);
  } catch (error) {
    return errorMessage(error, fallbackMessage);
  }
}

export function assertRoutePath(value: string, name: string): void {
  if (
    value.length === 0 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    hasControlCharacter(value)
  ) {
    throw new Error(`${name} must be a safe route path`);
  }

  if (value.includes("?") || value.includes("#")) {
    throw new Error(`${name} must not contain query strings or fragments`);
  }

  if (trimSlashes(value).split("/").some(isUnsafeRouteSegment)) {
    throw new Error(`${name} must be a safe route path`);
  }
}

function isUnsafeRouteSegment(segment: string): boolean {
  return segment === "." || segment === "..";
}

function normalizePath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;

  return normalized.endsWith("/") && normalized.length > 1
    ? normalized.slice(0, -1)
    : normalized;
}
