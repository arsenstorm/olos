import {
  routeIdentifierError,
  S3_COMPLETION_HINT_ACTION,
  S3_ROUTE_ACTIONS,
  S3_SESSION_ROUTE_SEGMENT,
  s3RouteParts,
} from "../runtime/route";

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

interface S3RouteOptions {
  sessionPath?: string;
}

type S3SessionRouteAction = Extract<
  S3Route,
  { slotId?: never; status: "matched" }
>["action"];

interface S3CompletionHintRouteParts {
  sessionId: string;
  slotId: string;
}

interface S3SessionRouteParts {
  action: S3SessionRouteAction;
  sessionId: string;
}

interface S3CompletionHintRouteCandidate {
  action: string | undefined;
  completion: string | undefined;
  parts: readonly string[];
  provider: string | undefined;
  sessionId: string | undefined;
}

type S3CompletionHintRouteShape = S3CompletionHintRouteCandidate & {
  action: string;
  sessionId: string;
};

type MatchedS3RouteParts = Extract<S3Route, { status: "matched" }>;

export function s3Route(request: Request, options: S3RouteOptions): S3Route {
  const url = new URL(request.url);
  const parts = s3RouteParts(url.pathname, options);

  if (parts === undefined) {
    return { status: "not_s3" };
  }

  if (parts === "invalid") {
    return invalidS3Route("route path contains invalid percent encoding");
  }

  const matched = matchedS3RouteParts(parts);

  if (matched === undefined) {
    return { status: "not_s3" };
  }

  const routeError = invalidPostS3Route(request, matched);

  if (routeError !== undefined) {
    return routeError;
  }

  return matched;
}

function matchedS3RouteParts(
  parts: readonly string[]
): MatchedS3RouteParts | undefined {
  const [sessionId, provider, action, completion] = parts;
  const completionHintParts = s3CompletionHintRouteParts(
    parts,
    sessionId,
    provider,
    action,
    completion
  );

  if (completionHintParts !== undefined) {
    return {
      action: "completion-hint",
      sessionId: completionHintParts.sessionId,
      slotId: completionHintParts.slotId,
      status: "matched",
    };
  }

  const sessionParts = s3SessionRouteParts(parts, sessionId, provider, action);

  if (sessionParts === undefined) {
    return;
  }

  return {
    action: sessionParts.action,
    sessionId: sessionParts.sessionId,
    status: "matched",
  };
}

function s3CompletionHintRouteParts(
  parts: readonly string[],
  sessionId: string | undefined,
  provider: string | undefined,
  action: string | undefined,
  completion: string | undefined
): S3CompletionHintRouteParts | undefined {
  const candidate = { action, completion, parts, provider, sessionId };

  if (!isS3CompletionHintRouteShape(candidate)) {
    return;
  }

  return { sessionId: candidate.sessionId, slotId: candidate.action };
}

function isS3CompletionHintRouteShape(
  candidate: S3CompletionHintRouteCandidate
): candidate is S3CompletionHintRouteShape {
  return (
    candidate.sessionId !== undefined &&
    candidate.provider === S3_ROUTE_ACTIONS.completionHint &&
    candidate.action !== undefined &&
    candidate.completion === S3_COMPLETION_HINT_ACTION &&
    candidate.parts.length === 4
  );
}

function s3SessionRouteParts(
  parts: readonly string[],
  sessionId: string | undefined,
  provider: string | undefined,
  action: string | undefined
): S3SessionRouteParts | undefined {
  if (
    sessionId === undefined ||
    provider !== S3_SESSION_ROUTE_SEGMENT ||
    !isS3SessionRouteAction(action) ||
    parts.length !== 3
  ) {
    return;
  }

  return { action, sessionId };
}

function isS3SessionRouteAction(
  action: string | undefined
): action is S3SessionRouteAction {
  return (
    action === S3_ROUTE_ACTIONS.slots ||
    action === S3_ROUTE_ACTIONS.commits ||
    action === S3_ROUTE_ACTIONS.events ||
    action === S3_ROUTE_ACTIONS.reconcilePlan ||
    action === S3_ROUTE_ACTIONS.retention ||
    action === S3_ROUTE_ACTIONS.reconcile
  );
}

function invalidPostS3Route(
  request: Request,
  route: { sessionId: string; slotId?: string }
): InvalidS3Route | { status: "method_not_allowed" } | undefined {
  if (request.method !== "POST") {
    return { status: "method_not_allowed" };
  }

  const sessionIdError = routeSessionIdError(route.sessionId);

  if (sessionIdError !== undefined) {
    return invalidS3Route(sessionIdError);
  }

  if (route.slotId === undefined) {
    return;
  }

  const slotIdError = routeSlotIdError(route.slotId);

  if (slotIdError !== undefined) {
    return invalidS3Route(slotIdError);
  }
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
