import { SESSION_STATES } from "../config/session";
import type { HlsCursorWaitContext } from "../hls/blocking-reload";
import type { CreateHlsManifestArtifactResponseOptions } from "../hls/manifest-artifacts";
import type {
  CoordinatorCommitPolicy,
  CoordinatorPipelineStore,
} from "../protocol/coordinator-types";
import { positiveMutationAttempts } from "../protocol/mutate-coordinator-store";
import type { PublicationControlPolicy } from "../state/publication-control";
import type { Cursor } from "../types/cursor";
import type { Session, SessionState } from "../types/session";
import type { PublicationMode } from "../types/upload-slot";
import { assertSafeDeliveryUrl } from "../validation/delivery-url";
import {
  errorMessage,
  isAllowedString,
  isRecord,
  nonNegativeNumber,
  positiveNumber,
  timestampString,
} from "../validation/fields";
import { assertSession } from "../validation/session";
import {
  isSuccessfulCommitStatus,
  type SuccessfulCommitStatus,
} from "./commit-status";
import type { RuntimeCursorNotifier } from "./cursor-notifier";
import { resolveRuntimeLiveHealthFromState } from "./health";
import { DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE } from "./latency-profile-defaults";
import { stringField, urlSafeIdentifierField } from "./request-fields";
import {
  boundedJsonRequestBody,
  isRuntimeJsonBodyTooLarge,
} from "./request-json";
import {
  jsonBadRequestResponse,
  jsonErrorResponse,
  jsonInternalErrorResponse,
  jsonMethodNotAllowedResponse,
  jsonNotFoundResponse,
  jsonResponse,
} from "./response";
import { planStoredCoordinatorRetention } from "./retention";
import {
  assertRoutePath,
  DEFAULT_LIVE_PATH,
  DEFAULT_SESSION_PATH,
  liveRouteParts,
  routeIdentifierError,
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
  serveStoredBlockingCoordinatorManifest,
  serveStoredCoordinatorManifest,
} from "./stored";

const DEFAULT_RUNTIME_OBJECT_LOW_LATENCY =
  DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE;
const DEFAULT_MAX_HEALTH_CURSOR_AGE_MS =
  DEFAULT_RUNTIME_OBJECT_LOW_LATENCY.cursorMaxAgeMs;
const DEFAULT_PUBLISHER_LEASE_TTL_MS =
  DEFAULT_RUNTIME_OBJECT_LOW_LATENCY.publisherLeaseTtlMs;
const DEFAULT_TARGET_LATENCY = DEFAULT_RUNTIME_OBJECT_LOW_LATENCY.targetLatency;
const defaultRuntimeNow = () => new Date().toISOString();

const GET_ONLY_SESSION_ROUTE_ACTIONS = [
  SESSION_ROUTE_ACTIONS.health,
  SESSION_ROUTE_ACTIONS.retention,
] as const;
const POST_ONLY_SESSION_ROUTE_ACTIONS = [
  SESSION_ROUTE_ACTIONS.commits,
  SESSION_ROUTE_ACTIONS.heartbeat,
  SESSION_ROUTE_ACTIONS.slots,
  SESSION_ROUTE_ACTIONS.transition,
] as const;

interface InvalidRuntimeHttpRequestParse {
  message: string;
  status: "invalid" | "too_large";
}

type RuntimeHttpRequestParse<Valid extends object> =
  | (Valid & { status: "valid" })
  | InvalidRuntimeHttpRequestParse;

type RuntimeLiveManifestRoute =
  | {
      kind: "master";
      sessionId: string;
    }
  | {
      kind: "media";
      sessionId: string;
    };

/** Options for `createStoredCoordinatorRuntimeHandler`. */
export interface CreateStoredCoordinatorRuntimeHandlerOptions {
  /** HTTPS origins media delivery URLs may point at. Origins only — no paths. */
  allowedMediaOrigins: readonly string[];
  /**
   * Enable low-latency blocking playlist reloads (`_HLS_msn`/`_HLS_part`).
   * `timeoutMs` bounds how long a reload is held open, in milliseconds;
   * `waitForCursor` resolves once the session's cursor advances (typically a
   * `RuntimeCursorNotifier`'s `waitForCursor`). Omit to serve media
   * playlists non-blocking.
   */
  blockingReload?: {
    timeoutMs: number;
    waitForCursor: (
      context: HlsCursorWaitContext
    ) => Promise<HlsCursorWaitContext["cursor"] | undefined>;
  };
  /** Alias for `now`, consulted only when `now` is not set. */
  clock?: () => string;
  commitPolicy?: CoordinatorCommitPolicy;
  /**
   * Notified with the new cursor after every successful commit and session
   * transition.
   */
  cursorNotifier?: RuntimeCursorNotifier;
  /** Default commit late tolerance, in milliseconds. */
  lateToleranceMs?: number;
  /** Route prefix for playlist requests; defaults to `/v1/live`. */
  livePath?: string;
  /** Max optimistic-save attempts per mutation; defaults to 2. */
  maxAttempts?: number;
  /**
   * Largest accepted JSON request body, in bytes; defaults to 1 MiB.
   * Oversized bodies are rejected with 413 before parsing.
   */
  maxBodyBytes?: number;
  /** Cursor age at which health reports stale, in ms; defaults to 5000. */
  maxHealthCursorAgeMs?: number;
  /**
   * Returns the current time as an ISO 8601 timestamp; defaults to the
   * system clock. Takes precedence over `clock`.
   */
  now?: () => string;
  publicationControl?: PublicationControlPolicy;
  /** Publication mode for created sessions; defaults to `direct-public`. */
  publicationMode?: PublicationMode;
  /** Publisher lease TTL granted on heartbeat, in ms; defaults to 3000. */
  publisherLeaseTtlMs?: number;
  /** Cache policy overrides for playlist responses. */
  response?: CreateHlsManifestArtifactResponseOptions;
  /** Route prefix for session requests; defaults to `/sessions`. */
  sessionPath?: string;
  store: CoordinatorPipelineStore;
  /** HLS target latency written into playlists, in seconds; defaults to 3. */
  targetLatency?: number;
}

/** Request handler returned by `createStoredCoordinatorRuntimeHandler`. */
export type StoredCoordinatorRuntimeHandler = (
  request: Request
) => Promise<Response>;

/**
 * Build a fetch-style handler that serves the whole coordinator HTTP API
 * from a `CoordinatorPipelineStore`: session create/transition/heartbeat,
 * slot issue, upload commit, health, retention planning, and live master /
 * media playlists. Unknown routes get a 404 and disallowed methods a 405;
 * error responses are JSON envelopes whose `error.code` is an `olos.*`
 * code. Option validation happens eagerly — invalid options throw here, not
 * per request.
 */
export function createStoredCoordinatorRuntimeHandler(
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): StoredCoordinatorRuntimeHandler {
  assertRuntimeHandlerOptions(options);

  return async (request) => {
    // Last-resort guard: no request input may crash the handler. Expected
    // failures resolve to 4xx envelopes before reaching here; anything else
    // becomes an opaque 500 `olos.internal` envelope.
    try {
      return await handleStoredRuntimeRequest(request, options);
    } catch {
      return jsonInternalErrorResponse();
    }
  };
}

function assertRuntimeHandlerOptions(
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): void {
  assertAllowedMediaOrigins(options.allowedMediaOrigins);
  assertRoutePath(options.sessionPath ?? DEFAULT_SESSION_PATH, "sessionPath");
  assertRoutePath(options.livePath ?? DEFAULT_LIVE_PATH, "livePath");

  positiveMutationAttempts(options.maxAttempts);

  if (options.targetLatency !== undefined) {
    positiveNumber(options.targetLatency, "targetLatency");
  }

  if (options.maxHealthCursorAgeMs !== undefined) {
    positiveNumber(options.maxHealthCursorAgeMs, "maxHealthCursorAgeMs");
  }

  if (options.publisherLeaseTtlMs !== undefined) {
    positiveNumber(options.publisherLeaseTtlMs, "publisherLeaseTtlMs");
  }

  if (options.lateToleranceMs !== undefined) {
    nonNegativeNumber(options.lateToleranceMs, "lateToleranceMs");
  }

  if (options.blockingReload !== undefined) {
    nonNegativeNumber(
      options.blockingReload.timeoutMs,
      "blockingReload.timeoutMs"
    );
  }

  if (options.maxBodyBytes !== undefined) {
    positiveNumber(options.maxBodyBytes, "maxBodyBytes");
  }
}

function assertAllowedMediaOrigins(origins: readonly string[]): void {
  for (const origin of origins) {
    let url: URL;

    try {
      url = new URL(origin);
    } catch {
      throw new Error("allowedMediaOrigins must contain HTTPS origins");
    }

    if (url.protocol !== "https:" || url.origin !== origin) {
      throw new Error("allowedMediaOrigins must contain HTTPS origins");
    }
  }
}

async function handleStoredRuntimeRequest(
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
        mediaBaseUrl: parsed.mediaBaseUrl,
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
    publicationControl: options.publicationControl,
    request,
    sessionId,
    store: options.store,
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

  // Transitions rewrite the cursor's state field; without a notification,
  // parked blocking reloads would sleep to their deadline instead of
  // serving the ENDLIST playlist, and the notifier would retain a
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

async function handleLiveRoute(
  request: Request,
  parts: readonly string[],
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<Response> {
  if (request.method !== "GET") {
    return jsonMethodNotAllowedResponse(["GET"]);
  }

  const route = liveManifestRoute(parts);

  if (route === undefined) {
    return notFound();
  }

  const sessionIdError = routeSessionIdError(route.sessionId);

  if (sessionIdError !== undefined) {
    return jsonBadRequestResponse(sessionIdError);
  }

  const snapshot = await options.store.load(route.sessionId);

  if (snapshot === undefined) {
    return sessionNotFound();
  }

  const manifest = liveManifestOptions(
    request,
    route.sessionId,
    snapshot.state.session,
    options
  );

  if (route.kind === "media" && options.blockingReload !== undefined) {
    return await serveStoredBlockingCoordinatorManifest({
      ...manifest,
      timeoutMs: options.blockingReload.timeoutMs,
      waitForCursor: options.blockingReload.waitForCursor,
    });
  }

  return await serveStoredCoordinatorManifest(manifest);
}

function liveManifestRoute(
  parts: readonly string[]
): RuntimeLiveManifestRoute | undefined {
  const [sessionId, first, second] = parts;

  if (sessionId !== undefined && first === "master.m3u8") {
    return { kind: "master", sessionId };
  }

  if (
    sessionId !== undefined &&
    first !== undefined &&
    second === "media.m3u8"
  ) {
    return { kind: "media", sessionId };
  }

  return;
}

function liveManifestOptions(
  request: Request,
  sessionId: string,
  session: Session,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
) {
  return {
    allowedMediaOrigins: options.allowedMediaOrigins,
    partTarget: session.partTarget,
    request,
    response: options.response,
    segmentTarget: session.segmentTarget,
    sessionId,
    store: options.store,
    targetLatency: options.targetLatency ?? DEFAULT_TARGET_LATENCY,
  };
}

async function parseSessionCreateRequest(
  request: Request,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<
  RuntimeHttpRequestParse<{
    mediaBaseUrl: string;
    session: Session;
  }>
> {
  try {
    const payload = await boundedJsonRequestBody(request, options.maxBodyBytes);

    if (!isRecord(payload)) {
      return invalid("session create request must be a JSON object");
    }

    assertSession(payload.session);

    if (typeof payload.mediaBaseUrl !== "string") {
      throw new Error("mediaBaseUrl must be a string");
    }

    // Validated at parse time so a hostile URL is a 400, not a throw from
    // the pipeline constructor.
    assertSafeDeliveryUrl(payload.mediaBaseUrl, "mediaBaseUrl");

    return {
      mediaBaseUrl: payload.mediaBaseUrl,
      session: payload.session,
      status: "valid",
    };
  } catch (error) {
    return invalidParse(error, "invalid session create request");
  }
}

async function parseTransitionRequest(
  request: Request,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<RuntimeHttpRequestParse<{ state: SessionState }>> {
  try {
    const payload = await boundedJsonRequestBody(request, options.maxBodyBytes);

    if (!isRecord(payload)) {
      return invalid("session transition request must be a JSON object");
    }

    return {
      state: sessionStateField(payload),
      status: "valid",
    };
  } catch (error) {
    return invalidParse(error, "invalid session transition request");
  }
}

function sessionStateField(value: Record<string, unknown>): SessionState {
  const state = stringField(value, "state");

  if (!isAllowedString(state, SESSION_STATES)) {
    throw new Error(`state must be one of: ${SESSION_STATES.join(", ")}`);
  }

  return state;
}

async function parseHeartbeatRequest(
  request: Request,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<RuntimeHttpRequestParse<{ publisherInstanceId: string }>> {
  try {
    const payload = await boundedJsonRequestBody(request, options.maxBodyBytes);

    if (!isRecord(payload)) {
      return invalid("publisher heartbeat request must be a JSON object");
    }

    return {
      publisherInstanceId: urlSafeIdentifierField(
        payload,
        "publisherInstanceId"
      ),
      status: "valid",
    };
  } catch (error) {
    return invalidParse(error, "invalid publisher heartbeat request");
  }
}

function retentionNow(
  request: Request,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): string | InvalidRuntimeHttpRequestParse {
  const queryNow = new URL(request.url).searchParams.get("now");

  if (queryNow === null) {
    return currentNow(options);
  }

  // A caller-supplied `now` is untrusted input: a malformed value is a 400
  // `olos.invalid_request`, not a throw from the retention planner.
  try {
    return timestampString(queryNow, "now");
  } catch (error) {
    return invalid(errorMessage(error, "invalid retention now"));
  }
}

function currentNow(options: CreateStoredCoordinatorRuntimeHandlerOptions) {
  if (options.now !== undefined) {
    return options.now();
  }

  if (options.clock !== undefined) {
    return options.clock();
  }

  return defaultRuntimeNow();
}

function routeSessionIdError(
  sessionId: string | undefined
): string | undefined {
  return routeIdentifierError(
    sessionId,
    "sessionId",
    "invalid route sessionId"
  );
}

function routePublisherInstanceIdError(
  publisherInstanceId: string | undefined
): string | undefined {
  if (publisherInstanceId === undefined) {
    return;
  }

  return routeIdentifierError(
    publisherInstanceId,
    "publisherInstanceId",
    "invalid publisherInstanceId"
  );
}

function invalid(message: string): InvalidRuntimeHttpRequestParse {
  return { message, status: "invalid" };
}

function invalidParse(
  error: unknown,
  fallbackMessage: string
): InvalidRuntimeHttpRequestParse {
  if (isRuntimeJsonBodyTooLarge(error)) {
    return { message: error.message, status: "too_large" };
  }

  return invalid(errorMessage(error, fallbackMessage));
}

function notFound(): Response {
  return jsonNotFoundResponse("route not found");
}

function sessionNotFound(): Response {
  return jsonErrorResponse(
    "olos.invalid_session",
    "coordinator session was not found",
    404
  );
}
