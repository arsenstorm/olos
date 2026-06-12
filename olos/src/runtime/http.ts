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
import type { RuntimeCursorNotifier } from "./cursor-notifier";
import { resolveRuntimeLiveHealthFromState } from "./health";
import { planStoredCoordinatorRetention } from "./retention";
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
  return async (request) => handleStoredRuntimeRequest(request, options);
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

  if (sessionParts !== undefined) {
    return await handleSessionRoute(request, sessionParts, options);
  }

  const liveParts = routeParts(
    url.pathname,
    options.livePath ?? DEFAULT_LIVE_PATH
  );

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
      maxAttempts: options.maxAttempts,
      publicationControl: options.publicationControl,
      request,
      sessionId,
      store: options.store,
    });

    notifyCursor(
      options.cursorNotifier,
      "state" in result ? result.state.cursor : undefined
    );

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
      return notFound();
    }

    const publisherInstanceId = new URL(request.url).searchParams.get(
      "publisherInstanceId"
    );

    return jsonResponse(
      {
        health: resolveRuntimeLiveHealthFromState({
          maxCursorAgeMs:
            options.maxHealthCursorAgeMs ??
            (options.targetLatency ?? DEFAULT_TARGET_LATENCY) * 1000,
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

  const snapshot = await options.store.load(sessionId);

  if (snapshot === undefined) {
    return notFound();
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

    if (!isRecord(payload.session)) {
      return invalid("session must be a JSON object");
    }

    if (!Array.isArray(payload.pathways)) {
      return invalid("pathways must be an array");
    }

    return {
      pathways: payload.pathways as readonly Pathway[],
      session: payload.session as unknown as Session,
      status: "valid",
    };
  } catch (error) {
    return invalid(errorMessage(error, "invalid session create request"));
  }
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

    if (typeof payload.state !== "string") {
      return invalid("state must be a string");
    }

    return {
      state: payload.state as SessionState,
      status: "valid",
    };
  } catch (error) {
    return invalid(errorMessage(error, "invalid session transition request"));
  }
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
      publisherInstanceId: stringField(payload, "publisherInstanceId"),
      status: "valid",
    };
  } catch (error) {
    return invalid(errorMessage(error, "invalid publisher heartbeat request"));
  }
}

function routeParts(
  pathname: string,
  routePath: string
): readonly string[] | undefined {
  const normalized = normalizePath(routePath);

  if (pathname !== normalized && !pathname.startsWith(`${normalized}/`)) {
    return;
  }

  return pathname
    .slice(normalized.length)
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
}

function normalizePath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;

  return normalized.endsWith("/") && normalized.length > 1
    ? normalized.slice(0, -1)
    : normalized;
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

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  });
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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
