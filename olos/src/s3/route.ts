import { sessionRootPathFromOptions, sessionRoutePath } from "../runtime/route";

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
export const S3_COMPLETION_HINT_ACTION = "complete";

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
