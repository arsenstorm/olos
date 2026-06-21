import { SESSION_STATES } from "../config/session";
import type { CoordinatorRetentionPlan } from "../protocol";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { Pathway } from "../types/pathway";
import type { Session, SessionState } from "../types/session";
import type { UploadSlot } from "../types/upload-slot";
import { assertCommit, assertUploadSlot } from "../validation";
import { assertCursor } from "../validation/cursor";
import { assertUrlSafeIdentifier } from "../validation/ids";
import type { RuntimeCommitPayload } from "./commit";
import type { RuntimeLiveHealth } from "./health";
import {
  fetchFor,
  isRecord,
  jsonPost,
  normalizedBaseUrl,
  optionalRecordPayload,
  type RuntimeHttpFetch,
  recordPayload,
  requiredArrayField,
  requiredRecordField,
  requiredRecordPayload,
  requiredStringField,
  responseBody,
} from "./http-client";
import { normalizedSafeRelativePath } from "./path";
import {
  assertRuntimePublisherLease,
  type RuntimePublisherLease,
} from "./publisher-lease";
import { nonNegativeInteger } from "./request-fields";
import {
  DEFAULT_LIVE_PATH,
  liveMasterPath,
  liveMediaPath,
  sessionRootPathFromOptions,
  sessionRoutePathFromOptions,
} from "./route";
import type { RuntimeSlotIssuePayload } from "./slot";
import { isStringLiteral } from "./string-literals";

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
    jsonPost({
      publisherInstanceId: options.publisherInstanceId,
    })
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
  const response = await fetchFor(options)(
    sessionsUrl(options.baseUrl),
    jsonPost({
      pathways: options.pathways,
      session: options.session,
    })
  );

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
    jsonPost({ state: options.state })
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
  const response = await fetchFor(options)(liveUrl(options));

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
  const url = liveUrl(options, options.renditionId);

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
  return new URL(sessionRootPathFromOptions(), normalizedBaseUrl(baseUrl));
}

function sessionUrl(baseUrl: string, sessionId: string, action: string): URL {
  return new URL(
    sessionRoutePathFromOptions(sessionId, action, {}),
    normalizedBaseUrl(baseUrl)
  );
}

function liveUrl(
  options: RuntimeMasterPlaylistOptions,
  renditionId?: string
): URL {
  const livePath = normalizedSafeRelativePath(
    options.livePath ?? DEFAULT_LIVE_PATH.slice(1),
    "livePath"
  );

  const relativePath =
    renditionId === undefined
      ? liveMasterPath(livePath, options.sessionId)
      : liveMediaPath(livePath, options.sessionId, renditionId);
  const requestPath =
    relativePath[0] === "/" ? relativePath.slice(1) : relativePath;

  return new URL(requestPath, normalizedBaseUrl(options.baseUrl));
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
    "publisher heartbeat response must include a lease",
    assertRuntimePublisherLease
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
  const state = requiredStringField(value, "state", message);

  return {
    sessionId: requiredStringField(value, "sessionId", message),
    state: assertSessionState(state),
  };
}

function slotPayload(value: unknown): UploadSlot {
  return requiredRecordPayload<UploadSlot>(
    value,
    "slot",
    "slot issue response must include a slot",
    assertUploadSlot
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
    commit: recordPayload<Commit>(commit, assertCommit),
    ...optionalCursorPayload(value),
  };
}

function optionalCursorPayload(
  value: unknown
): Pick<RuntimeCommitUploadResponse, "cursor"> | Record<string, never> {
  return optionalRecordPayload<"cursor", Cursor>(value, "cursor", assertCursor);
}

function healthPayload(value: unknown): RuntimeLiveHealth {
  return requiredRecordPayload<RuntimeLiveHealth>(
    value,
    "health",
    "session health response must include health",
    assertRuntimeLiveHealth
  );
}

function retentionPayload(value: unknown): CoordinatorRetentionPlan {
  return requiredRecordPayload<CoordinatorRetentionPlan>(
    value,
    "plan",
    "session retention response must include a plan",
    assertCoordinatorRetentionPlan
  );
}

function assertCoordinatorRetentionPlan(
  value: unknown
): asserts value is CoordinatorRetentionPlan {
  if (!isRecord(value)) {
    throw new Error("runtime session retention plan must be an object");
  }

  const expiredSlots = requiredArrayField(
    value,
    "expiredSlots",
    "runtime session retention plan must include expiredSlots"
  );

  expiredSlots.forEach((slot, index) => {
    if (!isRecord(slot)) {
      throw new Error(
        `runtime session retention plan expiredSlots[${index}] must be an object`
      );
    }

    try {
      assertUploadSlot(slot);
    } catch (error) {
      throw new Error(
        `runtime session retention plan expiredSlots[${index}] must be valid: ${
          (error as Error).message
        }`
      );
    }
  });

  const retiredObjects = requiredArrayField(
    value,
    "retiredObjects",
    "runtime session retention plan must include retiredObjects"
  );
  retiredObjects.forEach((retiredObject, index) => {
    if (!isRecord(retiredObject)) {
      throw new Error(
        `runtime session retention plan retiredObjects[${index}] must be an object`
      );
    }

    requiredStringField(
      retiredObject,
      "commitId",
      `runtime session retention plan retiredObjects[${index}].commitId must be set`
    );
    requiredStringField(
      retiredObject,
      "objectKey",
      `runtime session retention plan retiredObjects[${index}].objectKey must be set`
    );
    requiredStringField(
      retiredObject,
      "slotId",
      `runtime session retention plan retiredObjects[${index}].slotId must be set`
    );
  });

  if (value.cursor !== undefined) {
    if (!isRecord(value.cursor)) {
      throw new Error(
        "runtime session retention plan cursor must be an object"
      );
    }

    assertCursor(value.cursor);
  }
}

function assertRuntimeLiveHealth(
  value: unknown
): asserts value is RuntimeLiveHealth {
  if (!isRecord(value)) {
    throw new Error("runtime live health must be an object");
  }

  const cursorFreshness = requiredStringField(
    value,
    "cursorFreshness",
    "session health response health must include cursorFreshness"
  );
  if (
    cursorFreshness !== "fresh" &&
    cursorFreshness !== "stale" &&
    cursorFreshness !== "missing"
  ) {
    throw new Error(
      "session health response health.cursorFreshness must be fresh, stale, or missing"
    );
  }

  const status = requiredStringField(
    value,
    "status",
    "session health response health must include status"
  );
  if (status !== "active" && status !== "stale" && status !== "starting") {
    throw new Error(
      "session health response health.status must be active, stale, or starting"
    );
  }

  if (
    value.leaseStatus !== undefined &&
    value.leaseStatus !== "active" &&
    value.leaseStatus !== "stale"
  ) {
    throw new Error(
      "session health response health.leaseStatus must be active or stale"
    );
  }

  if (
    value.cursorAgeMs !== undefined &&
    (typeof value.cursorAgeMs !== "number" ||
      !Number.isFinite(value.cursorAgeMs))
  ) {
    throw new Error(
      "session health response health.cursorAgeMs must be a finite number"
    );
  }

  if (value.publisherInstanceId !== undefined) {
    assertUrlSafeIdentifier(
      value.publisherInstanceId,
      "session health response health.publisherInstanceId"
    );
  }
}

function assertSessionState(value: string): SessionState {
  if (!isStringLiteral(value, SESSION_STATES)) {
    throw new Error(
      `session transition response state must be one of: ${SESSION_STATES.join(", ")}`
    );
  }

  return value;
}
