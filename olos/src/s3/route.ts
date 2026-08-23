import { sessionRootPathFromOptions, sessionRoutePath } from "../runtime/route";

export const S3_ROUTE_ACTIONS = {
  commits: "commits",
  completionHint: "upload-slots",
  events: "events",
  reconcile: "reconcile",
  reconcilePlan: "reconcile-plan",
  retention: "retention",
  slots: "slots",
} as const;

export const S3_SESSION_ROUTE_SEGMENT = "s3";
export const S3_COMPLETION_HINT_ACTION = "complete";

export function s3RoutePath(sessionId: string, action: string): string {
  return sessionRoutePath(
    sessionRootPathFromOptions(),
    sessionId,
    `${S3_SESSION_ROUTE_SEGMENT}/${action}`
  );
}

export function s3CompletionHintRoutePath(
  sessionId: string,
  slotId: string
): string {
  return `${sessionRoutePath(
    sessionRootPathFromOptions(),
    sessionId,
    S3_ROUTE_ACTIONS.completionHint
  )}/${encodeURIComponent(slotId)}/${S3_COMPLETION_HINT_ACTION}`;
}
