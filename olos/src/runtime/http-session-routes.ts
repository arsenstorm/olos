import type { Cursor } from "../types/cursor";
import { isAllowedString } from "../validation/fields";
import {
  isSuccessfulCommitStatus,
  type SuccessfulCommitStatus,
} from "./commit-status";
import type { RuntimeCursorNotifier } from "./cursor-notifier";
import { resolveRuntimeLiveHealthFromState } from "./health";
import { handleLiveRoute } from "./http-live-route";
import {
  currentNow,
  notFound,
  parseHeartbeatRequest,
  parseSessionCreateRequest,
  parseTransitionRequest,
  retentionNow,
  routePublisherInstanceIdError,
  routeSessionIdError,
  sessionNotFound,
} from "./http-parse";
import {
  type CreateStoredCoordinatorRuntimeHandlerOptions,
  DEFAULT_MAX_HEALTH_CURSOR_AGE_MS,
  DEFAULT_PUBLISHER_LEASE_TTL_MS,
  GET_ONLY_SESSION_ROUTE_ACTIONS,
  type InvalidRuntimeHttpRequestParse,
  POST_ONLY_SESSION_ROUTE_ACTIONS,
  type RuntimeHttpRequestParse,
} from "./http-types";
import {
  jsonBadRequestResponse,
  jsonErrorResponse,
  jsonMethodNotAllowedResponse,
  jsonResponse,
} from "./response";
import { planStoredCoordinatorRetention } from "./retention";
import {
  liveRouteParts,
  SESSION_ROUTE_ACTIONS,
  sessionRouteParts,
} from "./route";
import {
  createStoredCoordinatorSession,
  heartbeatStoredCoordinatorPublisher,
  transitionStoredCoordinatorSession,
} from "./session";
import {
  commitStoredCoordinatorUploadFromRequest,
  issueStoredCoordinatorSlotFromRequest,
} from "./stored";
export async function handleStoredRuntimeRequest(
  request: Request,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<Response> {
  const url = new URL(request.url);
  const sessionParts = sessionRouteParts(url.pathname, options);

  if (sessionParts === "invalid") {
    return jsonBadRequestResponse(
      "route path contains invalid percent encoding"
    );
  }

  if (sessionParts !== undefined) {
    return await handleSessionRoute(request, sessionParts, options);
  }

  const liveParts = liveRouteParts(url.pathname, options);

  if (liveParts === "invalid") {
    return jsonBadRequestResponse(
      "route path contains invalid percent encoding"
    );
  }

  if (liveParts !== undefined) {
    return await handleLiveRoute(request, liveParts, options);
  }

  return notFound();
}

async function handleSessionRoute(
  request: Request,
  parts: readonly string[],
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<Response> {
  if (request.method === "POST" && parts.length === 0) {
    const parsed = await parseSessionCreateRequest(request, options);

    if (isInvalidRuntimeHttpRequestParse(parsed)) {
      return invalidRuntimeHttpRequestParseResponse(parsed);
    }

    return (
      await createStoredCoordinatorSession({
        deliveryBaseUrl: parsed.deliveryBaseUrl,
        publicationMode: options.publicationMode ?? "direct-public",
        session: parsed.session,
        store: options.store,
      })
    ).response;
  }

  const [sessionId, action] = parts;

  if (sessionId === undefined || action === undefined || parts.length !== 2) {
    return notFound();
  }

  const sessionIdError = routeSessionIdError(sessionId);

  if (sessionIdError !== undefined) {
    return jsonBadRequestResponse(sessionIdError);
  }

  return await handleSessionActionRoute(request, sessionId, action, options);
}

async function handleSessionActionRoute(
  request: Request,
  sessionId: string,
  action: string,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<Response> {
  if (request.method === "POST") {
    return await handlePostSessionActionRoute(
      request,
      sessionId,
      action,
      options
    );
  }

  if (request.method === "GET") {
    return await handleGetSessionActionRoute(
      request,
      sessionId,
      action,
      options
    );
  }

  return jsonMethodNotAllowedResponse(["GET", "POST"]);
}

async function handlePostSessionActionRoute(
  request: Request,
  sessionId: string,
  action: string,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<Response> {
  if (action === SESSION_ROUTE_ACTIONS.slots) {
    return await handlePostSlotRoute(request, sessionId, options);
  }

  if (action === SESSION_ROUTE_ACTIONS.commits) {
    return await handlePostCommitRoute(request, sessionId, options);
  }

  if (action === SESSION_ROUTE_ACTIONS.transition) {
    return await handlePostTransitionRoute(request, sessionId, options);
  }

  if (action === SESSION_ROUTE_ACTIONS.heartbeat) {
    return await handlePostHeartbeatRoute(request, sessionId, options);
  }

  // 405 only fits actions that exist under another method; for an unknown
  // action the route is missing and an Allow header would be a lie.
  if (isAllowedString(action, GET_ONLY_SESSION_ROUTE_ACTIONS)) {
    return jsonMethodNotAllowedResponse(["GET"]);
  }

  return notFound();
}

async function handlePostSlotRoute(
  request: Request,
  sessionId: string,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<Response> {
  return (
    await issueStoredCoordinatorSlotFromRequest({
      maxAttempts: options.maxAttempts,
      maxBodyBytes: options.maxBodyBytes,
      publicationControl: options.publicationControl,
      request,
      sessionId,
      store: options.store,
    })
  ).response;
}

async function handlePostCommitRoute(
  request: Request,
  sessionId: string,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<Response> {
  const result = await commitStoredCoordinatorUploadFromRequest({
    commitPolicy: options.commitPolicy,
    lateToleranceMs: options.lateToleranceMs,
    maxAttempts: options.maxAttempts,
    maxBodyBytes: options.maxBodyBytes,
    publicationControl: options.publicationControl,
    request,
    sessionId,
    store: options.store,
    trackWindowProfile: options.trackWindowProfile,
  });

  if (isSuccessfulRuntimeCommitResult(result)) {
    notifyCursor(options.cursorNotifier, result.state.cursor);
  }

  return result.response;
}

async function handlePostTransitionRoute(
  request: Request,
  sessionId: string,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<Response> {
  const parsed = await parseTransitionRequest(request, options);

  if (isInvalidRuntimeHttpRequestParse(parsed)) {
    return invalidRuntimeHttpRequestParseResponse(parsed);
  }

  const result = await transitionStoredCoordinatorSession({
    maxAttempts: options.maxAttempts,
    sessionId,
    state: parsed.state,
    store: options.store,
  });

  // Without a notification, parked blocking reloads would sleep to their
  // deadline instead of serving ENDLIST, and the notifier would retain a
  // terminal session's cursor forever.
  if (result.status === "transitioned") {
    notifyCursor(options.cursorNotifier, result.state.cursor);
  }

  return result.response;
}

async function handlePostHeartbeatRoute(
  request: Request,
  sessionId: string,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<Response> {
  const parsed = await parseHeartbeatRequest(request, options);

  if (isInvalidRuntimeHttpRequestParse(parsed)) {
    return invalidRuntimeHttpRequestParseResponse(parsed);
  }

  return (
    await heartbeatStoredCoordinatorPublisher({
      maxAttempts: options.maxAttempts,
      now: currentNow(options),
      publisherInstanceId: parsed.publisherInstanceId,
      sessionId,
      store: options.store,
      ttlMs: options.publisherLeaseTtlMs ?? DEFAULT_PUBLISHER_LEASE_TTL_MS,
    })
  ).response;
}

async function handleGetSessionActionRoute(
  request: Request,
  sessionId: string,
  action: string,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<Response> {
  if (action === SESSION_ROUTE_ACTIONS.retention) {
    const now = retentionNow(request, options);

    if (typeof now !== "string") {
      return invalidRuntimeHttpRequestParseResponse(now);
    }

    return (
      await planStoredCoordinatorRetention({
        lateToleranceMs: options.lateToleranceMs,
        now,
        sessionId,
        store: options.store,
      })
    ).response;
  }

  if (action === SESSION_ROUTE_ACTIONS.health) {
    return await handleGetHealthRoute(request, sessionId, options);
  }

  // Same split as the POST side: only actions that exist under POST get a
  // 405; unknown actions are missing routes.
  if (isAllowedString(action, POST_ONLY_SESSION_ROUTE_ACTIONS)) {
    return jsonMethodNotAllowedResponse(["POST"]);
  }

  return notFound();
}

async function handleGetHealthRoute(
  request: Request,
  sessionId: string,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<Response> {
  const snapshot = await options.store.load(sessionId);

  if (snapshot === undefined) {
    return sessionNotFound();
  }

  const publisherInstanceId = healthPublisherInstanceId(request);
  const publisherInstanceIdError =
    routePublisherInstanceIdError(publisherInstanceId);

  if (publisherInstanceIdError !== undefined) {
    return jsonBadRequestResponse(publisherInstanceIdError);
  }

  return jsonResponse(
    {
      health: resolveRuntimeLiveHealthFromState({
        maxCursorAgeMs:
          options.maxHealthCursorAgeMs ?? DEFAULT_MAX_HEALTH_CURSOR_AGE_MS,
        now: currentNow(options),
        ...(publisherInstanceId === undefined ? {} : { publisherInstanceId }),
        state: snapshot.state,
      }),
    },
    200
  );
}

function healthPublisherInstanceId(request: Request): string | undefined {
  return (
    new URL(request.url).searchParams.get("publisherInstanceId") ?? undefined
  );
}

function notifyCursor(
  notifier: RuntimeCursorNotifier | undefined,
  cursor: Cursor | undefined
): void {
  if (notifier !== undefined && cursor !== undefined) {
    notifier.notify(cursor);
  }
}

function isSuccessfulRuntimeCommitResult<
  Result extends Awaited<
    ReturnType<typeof commitStoredCoordinatorUploadFromRequest>
  >,
>(
  result: Result
): result is Extract<Result, { status: SuccessfulCommitStatus }> {
  return isSuccessfulCommitStatus(result.status);
}

function isInvalidRuntimeHttpRequestParse(
  parsed: RuntimeHttpRequestParse<object>
): parsed is InvalidRuntimeHttpRequestParse {
  return parsed.status === "invalid" || parsed.status === "too_large";
}

function invalidRuntimeHttpRequestParseResponse(
  parsed: InvalidRuntimeHttpRequestParse
): Response {
  if (parsed.status === "too_large") {
    return jsonErrorResponse("olos.invalid_request", parsed.message, 413);
  }

  return jsonBadRequestResponse(parsed.message);
}
