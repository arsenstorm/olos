import type { CreateHlsManifestArtifactResponseOptions } from "../hls";
import type { CoordinatorPipelineStore } from "../protocol";
import type { PublicationControlPolicy } from "../state";
import type { Pathway } from "../types/pathway";
import type { Session, SessionState } from "../types/session";
import { planStoredCoordinatorRetention } from "./retention";
import {
  createStoredCoordinatorSession,
  transitionStoredCoordinatorSession,
} from "./session";
import {
  commitStoredCoordinatorUploadFromRequest,
  issueStoredCoordinatorSlotFromRequest,
  serveStoredCoordinatorManifest,
} from "./stored";

const DEFAULT_LIVE_PATH = "/v1/live";
const DEFAULT_SESSION_PATH = "/sessions";
const DEFAULT_TARGET_LATENCY = 3;

export interface CreateStoredCoordinatorRuntimeHandlerOptions {
  allowedMediaOrigins: readonly string[];
  livePath?: string;
  maxAttempts?: number;
  now?: () => string;
  publicationControl?: PublicationControlPolicy;
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

  if (request.method === "POST" && action === "slots") {
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

  if (request.method === "POST" && action === "commits") {
    return (
      await commitStoredCoordinatorUploadFromRequest({
        maxAttempts: options.maxAttempts,
        publicationControl: options.publicationControl,
        request,
        sessionId,
        store: options.store,
      })
    ).response;
  }

  if (request.method === "POST" && action === "transition") {
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

  if (request.method === "GET" && action === "retention") {
    return (
      await planStoredCoordinatorRetention({
        now: retentionNow(request, options),
        sessionId,
        store: options.store,
      })
    ).response;
  }

  return methodNotAllowed();
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

  return await serveStoredCoordinatorManifest({
    allowedMediaOrigins: options.allowedMediaOrigins,
    partTarget: snapshot.state.session.partTarget,
    request,
    response: options.response,
    segmentTarget: snapshot.state.session.segmentTarget,
    sessionId,
    store: options.store,
    targetLatency: options.targetLatency ?? DEFAULT_TARGET_LATENCY,
  });
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

  return (
    url.searchParams.get("now") ?? options.now?.() ?? new Date().toISOString()
  );
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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
