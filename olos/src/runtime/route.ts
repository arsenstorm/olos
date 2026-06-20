import { assertUrlSafeIdentifier } from "../validation/ids";
import { errorMessage } from "./errors";

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

function normalizePath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;

  return normalized.endsWith("/") && normalized.length > 1
    ? normalized.slice(0, -1)
    : normalized;
}
