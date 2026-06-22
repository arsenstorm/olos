import { SESSION_STATES } from "../config/session";
import type {
  CreateHlsManifestArtifactResponseOptions,
  HlsCursorWaitContext,
} from "../hls";
import type {
  CoordinatorCommitPolicy,
  CoordinatorPipelineStore,
} from "../protocol";
import type { PublicationControlPolicy } from "../state";
import type { Cursor } from "../types/cursor";
import type { Pathway } from "../types/pathway";
import type { Session, SessionState } from "../types/session";
import { assertPathway } from "../validation/pathway";
import { assertSession } from "../validation/session";
import { positiveAttempts } from "./attempts";
import {
  isSuccessfulCommitStatus,
  type SuccessfulCommitStatus,
} from "./commit-status";
import type { RuntimeCursorNotifier } from "./cursor-notifier";
import { errorMessage } from "./errors";
import { resolveRuntimeLiveHealthFromState } from "./health";
import { DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE } from "./latency-profile";
import {
  isRecord,
  nonNegativeNumber,
  positiveNumber,
  stringField,
  urlSafeIdentifierField,
} from "./request-fields";
import {
  jsonBadRequestResponse,
  jsonErrorResponse,
  jsonMethodNotAllowedResponse,
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
import { isStringLiteral } from "./string-literals";

const DEFAULT_RUNTIME_OBJECT_LOW_LATENCY =
  DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE;
const DEFAULT_MAX_HEALTH_CURSOR_AGE_MS =
  DEFAULT_RUNTIME_OBJECT_LOW_LATENCY.cursorMaxAgeMs;
const DEFAULT_PUBLISHER_LEASE_TTL_MS =
  DEFAULT_RUNTIME_OBJECT_LOW_LATENCY.publisherLeaseTtlMs;
const DEFAULT_TARGET_LATENCY = DEFAULT_RUNTIME_OBJECT_LOW_LATENCY.targetLatency;
const defaultRuntimeNow = () => new Date().toISOString();

interface InvalidRuntimeHttpRequestParse {
  message: string;
  status: "invalid";
}

type RuntimeHttpRequestParse<Valid extends object> =
  | (Valid & { status: "valid" })
  | InvalidRuntimeHttpRequestParse;

export interface CreateStoredCoordinatorRuntimeHandlerOptions {
  allowedMediaOrigins: readonly string[];
  blockingReload?: {
    timeoutMs: number;
    waitForCursor: (
      context: HlsCursorWaitContext
    ) => Promise<HlsCursorWaitContext["cursor"] | undefined>;
  };
  clock?: () => string;
  commitPolicy?: CoordinatorCommitPolicy;
  cursorNotifier?: RuntimeCursorNotifier;
  lateToleranceMs?: number;
  livePath?: string;
  maxAttempts?: number;
  maxHealthCursorAgeMs?: number;
  now?: () => string;
  publicationControl?: PublicationControlPolicy;
  publisherLeaseTtlMs?: number;
  response?: CreateHlsManifestArtifactResponseOptions;
  sessionPath?: string;
  store: CoordinatorPipelineStore;
  targetLatency?: number;
}

export type StoredCoordinatorRuntimeHandler = (
  request: Request
) => Promise<Response>;

export function createStoredCoordinatorRuntimeHandler(
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): StoredCoordinatorRuntimeHandler {
  assertRuntimeHandlerOptions(options);

  return async (request) => handleStoredRuntimeRequest(request, options);
}

function assertRuntimeHandlerOptions(
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): void {
  assertAllowedMediaOrigins(options.allowedMediaOrigins);
  assertRoutePath(options.sessionPath ?? DEFAULT_SESSION_PATH, "sessionPath");
  assertRoutePath(options.livePath ?? DEFAULT_LIVE_PATH, "livePath");

  positiveAttempts(options.maxAttempts);

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
    const parsed = await parseSessionCreateRequest(request);

    if (parsed.status === "invalid") {
      return jsonBadRequestResponse(parsed.message);
    }

    return (
      await createStoredCoordinatorSession({
        pathways: parsed.pathways,
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

  return jsonMethodNotAllowedResponse();
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

  return jsonMethodNotAllowedResponse();
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
  const parsed = await parseTransitionRequest(request);

  if (parsed.status === "invalid") {
    return jsonBadRequestResponse(parsed.message);
  }

  return (
    await transitionStoredCoordinatorSession({
      maxAttempts: options.maxAttempts,
      sessionId,
      state: parsed.state,
      store: options.store,
    })
  ).response;
}

async function handlePostHeartbeatRoute(
  request: Request,
  sessionId: string,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<Response> {
  const parsed = await parseHeartbeatRequest(request);

  if (parsed.status === "invalid") {
    return jsonBadRequestResponse(parsed.message);
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
    return (
      await planStoredCoordinatorRetention({
        now: retentionNow(request, options),
        sessionId,
        store: options.store,
      })
    ).response;
  }

  if (action === SESSION_ROUTE_ACTIONS.health) {
    const snapshot = await options.store.load(sessionId);

    if (snapshot === undefined) {
      return sessionNotFound();
    }

    const publisherInstanceId = new URL(request.url).searchParams.get(
      "publisherInstanceId"
    );
    const publisherInstanceIdError = routePublisherInstanceIdError(
      publisherInstanceId ?? undefined
    );

    if (publisherInstanceIdError !== undefined) {
      return jsonBadRequestResponse(publisherInstanceIdError);
    }

    return jsonResponse(
      {
        health: resolveRuntimeLiveHealthFromState({
          maxCursorAgeMs:
            options.maxHealthCursorAgeMs ?? DEFAULT_MAX_HEALTH_CURSOR_AGE_MS,
          now: currentNow(options),
          ...(publisherInstanceId === null ? {} : { publisherInstanceId }),
          state: snapshot.state,
        }),
      },
      200
    );
  }

  return jsonMethodNotAllowedResponse();
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

async function handleLiveRoute(
  request: Request,
  parts: readonly string[],
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<Response> {
  if (request.method !== "GET") {
    return jsonMethodNotAllowedResponse();
  }

  const [sessionId, first, second] = parts;
  const isMaster = sessionId !== undefined && first === "master.m3u8";
  const isMedia =
    sessionId !== undefined && first !== undefined && second === "media.m3u8";

  if (!(isMaster || isMedia)) {
    return notFound();
  }

  const sessionIdError = routeSessionIdError(sessionId);

  if (sessionIdError !== undefined) {
    return jsonBadRequestResponse(sessionIdError);
  }

  const snapshot = await options.store.load(sessionId);

  if (snapshot === undefined) {
    return sessionNotFound();
  }

  const manifest = {
    allowedMediaOrigins: options.allowedMediaOrigins,
    partTarget: snapshot.state.session.partTarget,
    request,
    response: options.response,
    segmentTarget: snapshot.state.session.segmentTarget,
    sessionId,
    store: options.store,
    targetLatency: options.targetLatency ?? DEFAULT_TARGET_LATENCY,
  };

  if (isMedia && options.blockingReload !== undefined) {
    return await serveStoredBlockingCoordinatorManifest({
      ...manifest,
      timeoutMs: options.blockingReload.timeoutMs,
      waitForCursor: options.blockingReload.waitForCursor,
    });
  }

  return await serveStoredCoordinatorManifest(manifest);
}

async function parseSessionCreateRequest(request: Request): Promise<
  RuntimeHttpRequestParse<{
    pathways: readonly Pathway[];
    session: Session;
  }>
> {
  try {
    const payload = await request.json();

    if (!isRecord(payload)) {
      return invalid("session create request must be a JSON object");
    }

    assertSession(payload.session);

    return {
      pathways: parsePathways(payload.pathways),
      session: payload.session,
      status: "valid",
    };
  } catch (error) {
    return invalid(errorMessage(error, "invalid session create request"));
  }
}

function parsePathways(value: unknown): readonly Pathway[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("pathways must be a non-empty array");
  }

  for (const pathway of value) {
    assertPathway(pathway);
  }

  return value;
}

async function parseTransitionRequest(
  request: Request
): Promise<RuntimeHttpRequestParse<{ state: SessionState }>> {
  try {
    const payload = await request.json();

    if (!isRecord(payload)) {
      return invalid("session transition request must be a JSON object");
    }

    return {
      state: sessionStateField(payload),
      status: "valid",
    };
  } catch (error) {
    return invalid(errorMessage(error, "invalid session transition request"));
  }
}

function sessionStateField(value: Record<string, unknown>): SessionState {
  const state = stringField(value, "state");

  if (!isStringLiteral(state, SESSION_STATES)) {
    throw new Error(`state must be one of: ${SESSION_STATES.join(", ")}`);
  }

  return state;
}

async function parseHeartbeatRequest(
  request: Request
): Promise<RuntimeHttpRequestParse<{ publisherInstanceId: string }>> {
  try {
    const payload = await request.json();

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
    return invalid(errorMessage(error, "invalid publisher heartbeat request"));
  }
}

function retentionNow(
  request: Request,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): string {
  const url = new URL(request.url);

  return url.searchParams.get("now") ?? currentNow(options);
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

function notFound(): Response {
  return jsonErrorResponse("route not found", 404);
}

function sessionNotFound(): Response {
  return jsonErrorResponse("coordinator session was not found", 404);
}
