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
import { assertUrlSafeIdentifier } from "../validation/ids";
import { assertPathway } from "../validation/pathway";
import { assertSession } from "../validation/session";
import type { RuntimeCursorNotifier } from "./cursor-notifier";
import { resolveRuntimeLiveHealthFromState } from "./health";
import { createRuntimeObjectLowLatencyProfile } from "./latency-profile";
import { jsonResponse } from "./response";
import { planStoredCoordinatorRetention } from "./retention";
import { routeParts } from "./route";
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

const DEFAULT_LIVE_PATH = "/v1/live";
const DEFAULT_MAX_HEALTH_CURSOR_AGE_MS =
  createRuntimeObjectLowLatencyProfile().cursorMaxAgeMs;
const DEFAULT_PUBLISHER_LEASE_TTL_MS = 3000;
const DEFAULT_SESSION_PATH = "/sessions";
const DEFAULT_TARGET_LATENCY = 3;

export interface CreateStoredCoordinatorRuntimeHandlerOptions {
  allowedMediaOrigins: readonly string[];
  blockingReload?: {
    timeoutMs: number;
    waitForCursor: (
      context: HlsCursorWaitContext
    ) => Promise<HlsCursorWaitContext["cursor"] | undefined>;
  };
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

  if (
    options.maxAttempts !== undefined &&
    (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1)
  ) {
    throw new Error("maxAttempts must be a positive integer");
  }

  assertPositiveOption(options.targetLatency, "targetLatency");
  assertPositiveOption(options.maxHealthCursorAgeMs, "maxHealthCursorAgeMs");
  assertPositiveOption(options.publisherLeaseTtlMs, "publisherLeaseTtlMs");
  assertNonNegativeOption(options.lateToleranceMs, "lateToleranceMs");

  if (
    options.blockingReload !== undefined &&
    (!Number.isFinite(options.blockingReload.timeoutMs) ||
      options.blockingReload.timeoutMs < 0)
  ) {
    throw new Error("blockingReload.timeoutMs must be a non-negative number");
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

function assertRoutePath(value: string, name: string): void {
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

  if (trimRouteSlashes(value).split("/").some(isUnsafeRouteSegment)) {
    throw new Error(`${name} must be a safe route path`);
  }
}

function assertPositiveOption(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new Error(`${name} must be a positive number`);
  }
}

function assertNonNegativeOption(
  value: number | undefined,
  name: string
): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`${name} must be a non-negative number`);
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }

  return false;
}

function trimRouteSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function isUnsafeRouteSegment(segment: string): boolean {
  return segment === "." || segment === "..";
}

async function handleStoredRuntimeRequest(
  request: Request,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<Response> {
  const url = new URL(request.url);
  const sessionParts = routeParts(
    url.pathname,
    options.sessionPath ?? DEFAULT_SESSION_PATH
  );

  if (sessionParts === "invalid") {
    return badRequest("route path contains invalid percent encoding");
  }

  if (sessionParts !== undefined) {
    return await handleSessionRoute(request, sessionParts, options);
  }

  const liveParts = routeParts(
    url.pathname,
    options.livePath ?? DEFAULT_LIVE_PATH
  );

  if (liveParts === "invalid") {
    return badRequest("route path contains invalid percent encoding");
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
      return badRequest(parsed.message);
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
    return badRequest(sessionIdError);
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

  return methodNotAllowed();
}

async function handlePostSessionActionRoute(
  request: Request,
  sessionId: string,
  action: string,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<Response> {
  if (action === "slots") {
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

  if (action === "commits") {
    const result = await commitStoredCoordinatorUploadFromRequest({
      commitPolicy: options.commitPolicy,
      lateToleranceMs: options.lateToleranceMs,
      maxAttempts: options.maxAttempts,
      publicationControl: options.publicationControl,
      request,
      sessionId,
      store: options.store,
    });

    if (result.status === "committed" || result.status === "idempotent") {
      notifyCursor(options.cursorNotifier, result.state.cursor);
    }

    return result.response;
  }

  if (action === "transition") {
    const parsed = await parseTransitionRequest(request);

    if (parsed.status === "invalid") {
      return badRequest(parsed.message);
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

  if (action === "heartbeat") {
    const parsed = await parseHeartbeatRequest(request);

    if (parsed.status === "invalid") {
      return badRequest(parsed.message);
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

  return methodNotAllowed();
}

async function handleGetSessionActionRoute(
  request: Request,
  sessionId: string,
  action: string,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<Response> {
  if (action === "retention") {
    return (
      await planStoredCoordinatorRetention({
        now: retentionNow(request, options),
        sessionId,
        store: options.store,
      })
    ).response;
  }

  if (action === "health") {
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
      return badRequest(publisherInstanceIdError);
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

  return methodNotAllowed();
}

function notifyCursor(
  notifier: RuntimeCursorNotifier | undefined,
  cursor: Cursor | undefined
): void {
  if (notifier !== undefined && cursor !== undefined) {
    notifier.notify(cursor);
  }
}

async function handleLiveRoute(
  request: Request,
  parts: readonly string[],
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<Response> {
  if (request.method !== "GET") {
    return methodNotAllowed();
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
    return badRequest(sessionIdError);
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
  | {
      pathways: readonly Pathway[];
      session: Session;
      status: "valid";
    }
  | { message: string; status: "invalid" }
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

async function parseTransitionRequest(request: Request): Promise<
  | {
      state: SessionState;
      status: "valid";
    }
  | { message: string; status: "invalid" }
> {
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

  if (!SESSION_STATES.includes(state as SessionState)) {
    throw new Error(`state must be one of: ${SESSION_STATES.join(", ")}`);
  }

  return state as SessionState;
}

async function parseHeartbeatRequest(request: Request): Promise<
  | {
      publisherInstanceId: string;
      status: "valid";
    }
  | { message: string; status: "invalid" }
> {
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
  return options.now?.() ?? new Date().toISOString();
}

function routeSessionIdError(
  sessionId: string | undefined
): string | undefined {
  try {
    assertUrlSafeIdentifier(sessionId, "sessionId");
  } catch (error) {
    return errorMessage(error, "invalid route sessionId");
  }
}

function routePublisherInstanceIdError(
  publisherInstanceId: string | undefined
): string | undefined {
  if (publisherInstanceId === undefined) {
    return;
  }

  try {
    assertUrlSafeIdentifier(publisherInstanceId, "publisherInstanceId");
  } catch (error) {
    return errorMessage(error, "invalid publisherInstanceId");
  }
}

function invalid(message: string): { message: string; status: "invalid" } {
  return { message, status: "invalid" };
}

function badRequest(message: string): Response {
  return jsonResponse({ error: { message } }, 400);
}

function methodNotAllowed(): Response {
  return jsonResponse({ error: { message: "method not allowed" } }, 405);
}

function notFound(): Response {
  return jsonResponse({ error: { message: "route not found" } }, 404);
}

function sessionNotFound(): Response {
  return jsonResponse(
    { error: { message: "coordinator session was not found" } },
    404
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, field: string): string {
  if (typeof value[field] !== "string") {
    throw new Error(`${field} must be a string`);
  }

  return value[field];
}

function urlSafeIdentifierField(
  value: Record<string, unknown>,
  field: string
): string {
  assertUrlSafeIdentifier(value[field], field);

  return value[field];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
