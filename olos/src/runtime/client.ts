import type { CoordinatorRetentionPlan } from "../protocol";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { Pathway } from "../types/pathway";
import type { Session, SessionState } from "../types/session";
import type { UploadSlot } from "../types/upload-slot";
import { hasControlCharacter } from "../validation/fields";
import type { RuntimeCommitPayload } from "./commit";
import type { RuntimeLiveHealth } from "./health";
import {
  fetchFor,
  jsonPost,
  normalizedBaseUrl,
  optionalRecordPayload,
  type RuntimeHttpFetch,
  recordPayload,
  requiredRecordField,
  requiredRecordPayload,
  requiredStringField,
  responseBody,
} from "./http-client";
import { trimSlashes } from "./path";
import type { RuntimePublisherLease } from "./publisher-lease";
import { nonNegativeInteger } from "./request-fields";
import type { RuntimeSlotIssuePayload } from "./slot";

const URL_SCHEME_PREFIX = /^[A-Za-z][A-Za-z\d+.-]*:/;

export type RuntimeFetch = RuntimeHttpFetch;

export interface RuntimeHttpClientOptions {
  baseUrl: string;
  fetch?: RuntimeFetch;
}

export class RuntimeHttpError extends Error {
  readonly body: unknown;
  readonly response: Response;
  readonly status: number;

  constructor(message: string, response: Response, body: unknown) {
    super(message);
    this.body = body;
    this.name = "RuntimeHttpError";
    this.response = response;
    this.status = response.status;
  }
}

export interface RuntimePublisherHeartbeatOptions
  extends RuntimeHttpClientOptions {
  publisherInstanceId: string;
  sessionId: string;
}

export interface RuntimeCreateSessionOptions extends RuntimeHttpClientOptions {
  pathways: readonly Pathway[];
  session: Session;
}

export interface RuntimeTransitionSessionOptions
  extends RuntimeHttpClientOptions {
  sessionId: string;
  state: SessionState;
}

export interface RuntimeIssueSlotOptions extends RuntimeHttpClientOptions {
  payload: RuntimeSlotIssuePayload;
  sessionId: string;
}

export interface RuntimeCommitUploadOptions extends RuntimeHttpClientOptions {
  payload: RuntimeCommitPayload;
  sessionId: string;
}

export interface RuntimeSessionHealthOptions extends RuntimeHttpClientOptions {
  publisherInstanceId?: string;
  sessionId: string;
}

export interface RuntimeSessionRetentionOptions
  extends RuntimeHttpClientOptions {
  now?: string;
  sessionId: string;
}

export interface RuntimeMasterPlaylistOptions extends RuntimeHttpClientOptions {
  livePath?: string;
  sessionId: string;
}

export interface RuntimeMediaPlaylistOptions
  extends RuntimeMasterPlaylistOptions {
  hlsMsn?: number;
  hlsPart?: number;
  renditionId: string;
}

export interface RuntimePublisherHeartbeatResponse {
  lease: RuntimePublisherLease;
  response: Response;
}

export interface RuntimeCreateSessionResponse {
  response: Response;
  sessionId: string;
}

export interface RuntimeTransitionSessionResponse {
  response: Response;
  sessionId: string;
  state: SessionState;
}

export interface RuntimeIssueSlotResponse {
  response: Response;
  slot: UploadSlot;
}

export interface RuntimeCommitUploadResponse {
  commit: Commit;
  cursor?: Cursor;
  response: Response;
}

export interface RuntimeSessionHealthResponse {
  health: RuntimeLiveHealth;
  response: Response;
}

export interface RuntimeSessionRetentionResponse {
  plan: CoordinatorRetentionPlan;
  response: Response;
}

export interface RuntimePlaylistResponse {
  playlist: string;
  response: Response;
}

export async function sendRuntimePublisherHeartbeat(
  options: RuntimePublisherHeartbeatOptions
): Promise<RuntimePublisherHeartbeatResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, "heartbeat"),
    {
      body: JSON.stringify({
        publisherInstanceId: options.publisherInstanceId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }
  );

  if (!response.ok) {
    throw await runtimeHttpError("publisher heartbeat", response);
  }

  return {
    lease: leasePayload(await response.json()),
    response,
  };
}

export async function createRuntimeSession(
  options: RuntimeCreateSessionOptions
): Promise<RuntimeCreateSessionResponse> {
  const response = await fetchFor(options)(sessionsUrl(options.baseUrl), {
    body: JSON.stringify({
      pathways: options.pathways,
      session: options.session,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw await runtimeHttpError("session create", response);
  }

  return {
    response,
    sessionId: sessionIdPayload(await response.json(), "session create"),
  };
}

export async function transitionRuntimeSession(
  options: RuntimeTransitionSessionOptions
): Promise<RuntimeTransitionSessionResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, "transition"),
    {
      body: JSON.stringify({ state: options.state }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }
  );

  if (!response.ok) {
    throw await runtimeHttpError("session transition", response);
  }

  const payload = transitionPayload(await response.json());

  return {
    ...payload,
    response,
  };
}

export async function issueRuntimeSlot(
  options: RuntimeIssueSlotOptions
): Promise<RuntimeIssueSlotResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, "slots"),
    jsonPost(options.payload)
  );

  if (!response.ok) {
    throw await runtimeHttpError("slot issue", response);
  }

  return {
    response,
    slot: slotPayload(await response.json()),
  };
}

export async function commitRuntimeUpload(
  options: RuntimeCommitUploadOptions
): Promise<RuntimeCommitUploadResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, "commits"),
    jsonPost(options.payload)
  );

  if (!response.ok) {
    throw await runtimeHttpError("upload commit", response);
  }

  return {
    ...commitPayload(await response.json()),
    response,
  };
}

export async function getRuntimeSessionHealth(
  options: RuntimeSessionHealthOptions
): Promise<RuntimeSessionHealthResponse> {
  const url = sessionUrl(options.baseUrl, options.sessionId, "health");

  if (options.publisherInstanceId !== undefined) {
    url.searchParams.set("publisherInstanceId", options.publisherInstanceId);
  }

  const response = await fetchFor(options)(url);

  if (!response.ok) {
    throw await runtimeHttpError("session health", response);
  }

  return {
    health: healthPayload(await response.json()),
    response,
  };
}

export async function getRuntimeSessionRetentionPlan(
  options: RuntimeSessionRetentionOptions
): Promise<RuntimeSessionRetentionResponse> {
  const url = sessionUrl(options.baseUrl, options.sessionId, "retention");

  if (options.now !== undefined) {
    url.searchParams.set("now", options.now);
  }

  const response = await fetchFor(options)(url);

  if (!response.ok) {
    throw await runtimeHttpError("session retention", response);
  }

  return {
    plan: retentionPayload(await response.json()),
    response,
  };
}

export async function getRuntimeMasterPlaylist(
  options: RuntimeMasterPlaylistOptions
): Promise<RuntimePlaylistResponse> {
  const response = await fetchFor(options)(
    liveUrl(options, `${encodeURIComponent(options.sessionId)}/master.m3u8`)
  );

  if (!response.ok) {
    throw await runtimeHttpError("master playlist", response);
  }

  return {
    playlist: await response.text(),
    response,
  };
}

export async function getRuntimeMediaPlaylist(
  options: RuntimeMediaPlaylistOptions
): Promise<RuntimePlaylistResponse> {
  const url = liveUrl(
    options,
    `${encodeURIComponent(options.sessionId)}/${encodeURIComponent(
      options.renditionId
    )}/media.m3u8`
  );

  if (options.hlsMsn !== undefined) {
    nonNegativeInteger(options.hlsMsn, "hlsMsn");
    url.searchParams.set("_HLS_msn", String(options.hlsMsn));
  }

  if (options.hlsPart !== undefined) {
    nonNegativeInteger(options.hlsPart, "hlsPart");
    url.searchParams.set("_HLS_part", String(options.hlsPart));
  }

  const response = await fetchFor(options)(url);

  if (!response.ok) {
    throw await runtimeHttpError("media playlist", response);
  }

  return {
    playlist: await response.text(),
    response,
  };
}

function sessionsUrl(baseUrl: string): URL {
  return new URL("sessions", normalizedBaseUrl(baseUrl));
}

function sessionUrl(baseUrl: string, sessionId: string, action: string): URL {
  return new URL(
    `sessions/${encodeURIComponent(sessionId)}/${action}`,
    normalizedBaseUrl(baseUrl)
  );
}

function liveUrl(options: RuntimeMasterPlaylistOptions, path: string): URL {
  const livePath = normalizedLivePath(options.livePath ?? "v1/live");
  return new URL(`${livePath}/${path}`, normalizedBaseUrl(options.baseUrl));
}

function normalizedLivePath(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("//") ||
    value.includes("?") ||
    value.includes("#") ||
    hasControlCharacter(value) ||
    URL_SCHEME_PREFIX.test(value)
  ) {
    throw new Error("livePath must be a safe relative path");
  }

  const path = trimSlashes(value);

  if (
    path.length === 0 ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("livePath must be a safe relative path");
  }

  return path;
}

async function runtimeHttpError(
  operation: string,
  response: Response
): Promise<RuntimeHttpError> {
  return new RuntimeHttpError(
    `${operation} failed with status ${response.status}`,
    response,
    await responseBody(response)
  );
}

function leasePayload(value: unknown): RuntimePublisherLease {
  return requiredRecordPayload<RuntimePublisherLease>(
    value,
    "lease",
    "publisher heartbeat response must include a lease"
  );
}

function sessionIdPayload(value: unknown, context: string): string {
  return requiredStringField(
    value,
    "sessionId",
    `${context} response must include sessionId`
  );
}

function transitionPayload(
  value: unknown
): Omit<RuntimeTransitionSessionResponse, "response"> {
  const message =
    "session transition response must include sessionId and state";

  return {
    sessionId: requiredStringField(value, "sessionId", message),
    state: requiredStringField(value, "state", message) as SessionState,
  };
}

function slotPayload(value: unknown): UploadSlot {
  return requiredRecordPayload<UploadSlot>(
    value,
    "slot",
    "slot issue response must include a slot"
  );
}

function commitPayload(
  value: unknown
): Omit<RuntimeCommitUploadResponse, "response"> {
  const commit = requiredRecordField(
    value,
    "commit",
    "upload commit response must include a commit"
  );

  return {
    commit: recordPayload<Commit>(commit),
    ...optionalCursorPayload(value),
  };
}

function optionalCursorPayload(
  value: unknown
): Pick<RuntimeCommitUploadResponse, "cursor"> | Record<string, never> {
  return optionalRecordPayload<"cursor", Cursor>(value, "cursor");
}

function healthPayload(value: unknown): RuntimeLiveHealth {
  return requiredRecordPayload<RuntimeLiveHealth>(
    value,
    "health",
    "session health response must include health"
  );
}

function retentionPayload(value: unknown): CoordinatorRetentionPlan {
  return requiredRecordPayload<CoordinatorRetentionPlan>(
    value,
    "plan",
    "session retention response must include a plan"
  );
}
