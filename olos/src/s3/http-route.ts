import {
  routeIdentifierError,
  S3_COMPLETION_HINT_ACTION,
  S3_ROUTE_ACTIONS,
  S3_SESSION_ROUTE_SEGMENT,
  s3RouteParts,
} from "../runtime/route";
import type { CreateStoredS3CoordinatorRuntimeHandlerOptions } from "./http";

interface InvalidS3Route {
  message: string;
  status: "invalid";
}

type S3Route =
  | {
      action: "completion-hint";
      sessionId: string;
      slotId: string;
      status: "matched";
    }
  | {
      action:
        | "commits"
        | "events"
        | "reconcile"
        | "reconcile-plan"
        | "retention"
        | "slots";
      sessionId: string;
      status: "matched";
    }
  | InvalidS3Route
  | { status: "method_not_allowed" }
  | { status: "not_s3" };

export function s3Route(
  request: Request,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): S3Route {
  const url = new URL(request.url);
  const parts = s3RouteParts(url.pathname, options);

  if (parts === undefined) {
    return { status: "not_s3" };
  }

  if (parts === "invalid") {
    return invalidS3Route("route path contains invalid percent encoding");
  }

  const [sessionId, provider, action, completion] = parts;

  if (
    sessionId !== undefined &&
    provider === S3_ROUTE_ACTIONS.completionHint &&
    action !== undefined &&
    completion === S3_COMPLETION_HINT_ACTION &&
    parts.length === 4
  ) {
    if (request.method !== "POST") {
      return { status: "method_not_allowed" };
    }

    const sessionIdError = routeSessionIdError(sessionId);

    if (sessionIdError !== undefined) {
      return invalidS3Route(sessionIdError);
    }

    const slotIdError = routeSlotIdError(action);

    if (slotIdError !== undefined) {
      return invalidS3Route(slotIdError);
    }

    return {
      action: "completion-hint",
      sessionId,
      slotId: action,
      status: "matched",
    };
  }

  if (
    sessionId === undefined ||
    provider !== S3_SESSION_ROUTE_SEGMENT ||
    (action !== S3_ROUTE_ACTIONS.slots &&
      action !== S3_ROUTE_ACTIONS.commits &&
      action !== S3_ROUTE_ACTIONS.events &&
      action !== S3_ROUTE_ACTIONS.reconcilePlan &&
      action !== S3_ROUTE_ACTIONS.retention &&
      action !== S3_ROUTE_ACTIONS.reconcile) ||
    parts.length !== 3
  ) {
    return { status: "not_s3" };
  }

  if (request.method !== "POST") {
    return { status: "method_not_allowed" };
  }

  const sessionIdError = routeSessionIdError(sessionId);

  if (sessionIdError !== undefined) {
    return invalidS3Route(sessionIdError);
  }

  return { action, sessionId, status: "matched" };
}

function routeSessionIdError(sessionId: string): string | undefined {
  return routeIdentifierError(
    sessionId,
    "sessionId",
    "invalid route sessionId"
  );
}

function routeSlotIdError(slotId: string): string | undefined {
  return routeIdentifierError(slotId, "slotId", "invalid route slotId");
}

function invalidS3Route(message: string): InvalidS3Route {
  return { message, status: "invalid" };
}

export type { InvalidS3Route, S3Route };
