import type { CoordinatorRetentionPlan } from "../protocol";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { Pathway } from "../types/pathway";
import type { Session, SessionState } from "../types/session";
import type { UploadSlot } from "../types/upload-slot";
import type { RuntimeCommitPayload } from "./commit";
import type { RuntimeLiveHealth } from "./health";
import type { RuntimePublisherLease } from "./publisher-lease";
import type { RuntimeSlotIssuePayload } from "./slot";

export type RuntimeFetch = (
  input: Request | URL | string,
  init?: RequestInit
) => Promise<Response>;

export interface RuntimeHttpClientOptions {
  baseUrl: string;
  fetch?: RuntimeFetch;
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
    throw new Error(
      `publisher heartbeat failed with status ${response.status}`
    );
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
    throw new Error(`session create failed with status ${response.status}`);
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
    throw new Error(`session transition failed with status ${response.status}`);
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
    throw new Error(`slot issue failed with status ${response.status}`);
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
    throw new Error(`upload commit failed with status ${response.status}`);
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
    throw new Error(`session health failed with status ${response.status}`);
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
    throw new Error(`session retention failed with status ${response.status}`);
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
    throw new Error(`master playlist failed with status ${response.status}`);
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
    url.searchParams.set("_HLS_msn", String(options.hlsMsn));
  }

  if (options.hlsPart !== undefined) {
    url.searchParams.set("_HLS_part", String(options.hlsPart));
  }

  const response = await fetchFor(options)(url);

  if (!response.ok) {
    throw new Error(`media playlist failed with status ${response.status}`);
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
  const livePath = options.livePath ?? "v1/live";
  return new URL(
    `${trimSlashes(livePath)}/${path}`,
    normalizedBaseUrl(options.baseUrl)
  );
}

function jsonPost(body: unknown): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  };
}

function normalizedBaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function fetchFor(options: RuntimeHttpClientOptions): RuntimeFetch {
  return options.fetch ?? fetch;
}

function leasePayload(value: unknown): RuntimePublisherLease {
  if (!(isRecord(value) && isRecord(value.lease))) {
    throw new Error("publisher heartbeat response must include a lease");
  }

  return value.lease as unknown as RuntimePublisherLease;
}

function sessionIdPayload(value: unknown, context: string): string {
  if (!(isRecord(value) && typeof value.sessionId === "string")) {
    throw new Error(`${context} response must include sessionId`);
  }

  return value.sessionId;
}

function transitionPayload(
  value: unknown
): Omit<RuntimeTransitionSessionResponse, "response"> {
  if (
    !(
      isRecord(value) &&
      typeof value.sessionId === "string" &&
      typeof value.state === "string"
    )
  ) {
    throw new Error(
      "session transition response must include sessionId and state"
    );
  }

  return {
    sessionId: value.sessionId,
    state: value.state as SessionState,
  };
}

function slotPayload(value: unknown): UploadSlot {
  if (!(isRecord(value) && isRecord(value.slot))) {
    throw new Error("slot issue response must include a slot");
  }

  return value.slot as unknown as UploadSlot;
}

function commitPayload(
  value: unknown
): Omit<RuntimeCommitUploadResponse, "response"> {
  if (!(isRecord(value) && isRecord(value.commit))) {
    throw new Error("upload commit response must include a commit");
  }

  return {
    commit: value.commit as unknown as Commit,
    ...(isRecord(value.cursor)
      ? { cursor: value.cursor as unknown as Cursor }
      : {}),
  };
}

function healthPayload(value: unknown): RuntimeLiveHealth {
  if (!(isRecord(value) && isRecord(value.health))) {
    throw new Error("session health response must include health");
  }

  return value.health as unknown as RuntimeLiveHealth;
}

function retentionPayload(value: unknown): CoordinatorRetentionPlan {
  if (!(isRecord(value) && isRecord(value.plan))) {
    throw new Error("session retention response must include a plan");
  }

  return value.plan as unknown as CoordinatorRetentionPlan;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
