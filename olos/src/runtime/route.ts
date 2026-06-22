import { hasControlCharacter } from "../validation/fields";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { errorMessage } from "./errors";
import { trimSlashes } from "./path";

export const DEFAULT_LIVE_PATH = "/v1/live";
export const DEFAULT_SESSION_PATH = "/sessions";

export const SESSION_ROUTE_ACTIONS = {
  commits: "commits",
  health: "health",
  heartbeat: "heartbeat",
  retention: "retention",
  slots: "slots",
  transition: "transition",
} as const;

export const S3_ROUTE_ACTIONS = {
  completionHint: "upload-slots",
  commits: "commits",
  events: "events",
  reconcile: "reconcile",
  reconcilePlan: "reconcile-plan",
  retention: "retention",
  slots: "slots",
} as const;

export const S3_SESSION_ROUTE_SEGMENT = "s3";
const LIVE_MASTER_PLAYLIST_PATH = "master.m3u8";
const LIVE_MEDIA_PLAYLIST_PATH = "media.m3u8";
export const S3_COMPLETION_HINT_ACTION = "complete";

export function sessionRootPath(sessionPath: string): string {
  return normalizePath(sessionPath);
}

export function sessionRoutePath(
  sessionPath: string,
  sessionId: string,
  action: string
): string {
  return `${sessionRootPath(sessionPath)}/${encodeURIComponent(sessionId)}/${action}`;
}

export function sessionRoutePathFromOptions(
  sessionId: string,
  action: string,
  options: { sessionPath?: string } = {}
): string {
  return sessionRoutePath(
    sessionRootPathFromOptions(options),
    sessionId,
    action
  );
}

export function s3RoutePath(
  sessionPath: string,
  sessionId: string,
  action: string
): string {
  return sessionRoutePath(
    sessionPath,
    sessionId,
    `${S3_SESSION_ROUTE_SEGMENT}/${action}`
  );
}

export function s3RoutePathFromOptions(
  sessionId: string,
  action: string,
  options: { sessionPath?: string } = {}
): string {
  return s3RoutePath(sessionRootPathFromOptions(options), sessionId, action);
}

export function s3CompletionHintRoutePath(
  sessionPath: string,
  sessionId: string,
  slotId: string
): string {
  return `${sessionRoutePath(sessionPath, sessionId, S3_ROUTE_ACTIONS.completionHint)}/${encodeURIComponent(
    slotId
  )}/${S3_COMPLETION_HINT_ACTION}`;
}

export function s3CompletionHintRoutePathFromOptions(
  sessionId: string,
  slotId: string,
  options: { sessionPath?: string } = {}
): string {
  return s3CompletionHintRoutePath(
    sessionRootPathFromOptions(options),
    sessionId,
    slotId
  );
}

export function sessionRootPathFromOptions(
  options: { sessionPath?: string } = {}
): string {
  return sessionRootPath(options.sessionPath ?? DEFAULT_SESSION_PATH);
}

export function liveRootPathFromOptions(
  options: { livePath?: string } = {}
): string {
  return sessionRootPath(options.livePath ?? DEFAULT_LIVE_PATH);
}

export function sessionRouteParts(
  pathname: string,
  options: { sessionPath?: string } = {}
): "invalid" | readonly string[] | undefined {
  return routeParts(pathname, sessionRootPathFromOptions(options));
}

export function s3RouteParts(
  pathname: string,
  options: { sessionPath?: string } = {}
): "invalid" | readonly string[] | undefined {
  return sessionRouteParts(pathname, options);
}

export function liveRouteParts(
  pathname: string,
  options: { livePath?: string } = {}
): "invalid" | readonly string[] | undefined {
  return routeParts(pathname, liveRootPathFromOptions(options));
}

export function liveMasterPath(livePath: string, sessionId: string): string {
  return `${sessionRootPath(livePath)}/${encodeURIComponent(
    sessionId
  )}/${LIVE_MASTER_PLAYLIST_PATH}`;
}

export function liveMediaPath(
  livePath: string,
  sessionId: string,
  renditionId: string
): string {
  return `${sessionRootPath(livePath)}/${encodeURIComponent(
    sessionId
  )}/${encodeURIComponent(renditionId)}/${LIVE_MEDIA_PLAYLIST_PATH}`;
}

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
  assertRoutePathShape(value, name);
  assertRoutePathHasNoQueryOrFragment(value, name);
  assertRoutePathSegments(value, name);
}

function assertRoutePathShape(value: string, name: string): void {
  if (
    value.length === 0 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    hasControlCharacter(value)
  ) {
    throw new Error(`${name} must be a safe route path`);
  }
}

function assertRoutePathHasNoQueryOrFragment(
  value: string,
  name: string
): void {
  if (value.includes("?") || value.includes("#")) {
    throw new Error(`${name} must not contain query strings or fragments`);
  }
}

function assertRoutePathSegments(value: string, name: string): void {
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
