import { SESSION_STATES } from "../config/session";
import type { CoordinatorRetentionPlan } from "../protocol/coordinator-types";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { Session, SessionState } from "../types/session";
import type { UploadSlot } from "../types/upload-slot";
import { parseCommit } from "../validation/commit";
import { parseCursor } from "../validation/cursor";
import { errorMessage, isAllowedString, isRecord } from "../validation/fields";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { parseUploadSlot } from "../validation/upload-slot";
import type { RuntimeCommitPayload } from "./commit";
import type { RuntimeLiveHealth } from "./health";
import {
  fetchFor,
  jsonPost,
  normalizedBaseUrl,
  optionalParsedPayload,
  type RuntimeHttpFetch,
  requiredArrayField,
  requiredParsedPayload,
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

const HEALTH_CURSOR_FRESHNESS_VALUES = ["fresh", "stale", "missing"] as const;
const HEALTH_STATUS_VALUES = ["active", "stale", "starting"] as const;
const HEALTH_LEASE_STATUS_VALUES = ["active", "stale"] as const;

/**
 * Fetch-compatible function the runtime HTTP client uses to send requests.
 * Defaults to the global `fetch`; override it to add authentication,
 * retries, or to route requests in tests.
 */
export type RuntimeFetch = RuntimeHttpFetch;

/** Connection options shared by every runtime HTTP client call. */
export interface RuntimeHttpClientOptions {
  /**
   * Coordinator base URL. A trailing slash is added when missing so route
   * paths resolve underneath it.
   */
  baseUrl: string;
  /** Transport override; defaults to the global `fetch`. */
  fetch?: RuntimeFetch;
}

/**
 * Error thrown by the runtime HTTP client when the coordinator returns a
 * non-2xx response. Client calls never return structured error results; any
 * failed response surfaces as this throw. The response body is read from a
 * clone and exposed as `body`: parsed JSON when possible — for coordinator
 * errors an envelope whose `error.code` is an `olos.*` code — otherwise the
 * raw text, or `undefined` when the body is empty.
 */
export class RuntimeHttpError extends Error {
  /**
   * Response body: parsed JSON when possible, otherwise the raw text;
   * `undefined` when the body is empty.
   */
  readonly body: unknown;
  readonly response: Response;
  /** HTTP status code, mirrored from `response.status`. */
  readonly status: number;

  constructor(message: string, response: Response, body: unknown) {
    super(message);
    this.body = body;
    this.name = "RuntimeHttpError";
    this.response = response;
    this.status = response.status;
  }
}

/** Options for `sendRuntimePublisherHeartbeat`. */
export interface RuntimePublisherHeartbeatOptions
  extends RuntimeHttpClientOptions {
  publisherInstanceId: string;
  sessionId: string;
}

/** Options for `createRuntimeSession`. */
export interface RuntimeCreateSessionOptions extends RuntimeHttpClientOptions {
  /** Public base URL that delivery URLs for the session's media resolve to. */
  mediaBaseUrl: string;
  session: Session;
}

/** Options for `transitionRuntimeSession`. */
export interface RuntimeTransitionSessionOptions
  extends RuntimeHttpClientOptions {
  sessionId: string;
  /** Target session state to transition to. */
  state: SessionState;
}

/** Options for `issueRuntimeSlot`. */
export interface RuntimeIssueSlotOptions extends RuntimeHttpClientOptions {
  payload: RuntimeSlotIssuePayload;
  sessionId: string;
}

/** Options for `commitRuntimeUpload`. */
export interface RuntimeCommitUploadOptions extends RuntimeHttpClientOptions {
  payload: RuntimeCommitPayload;
  sessionId: string;
}

/** Options for `getRuntimeSessionHealth`. */
export interface RuntimeSessionHealthOptions extends RuntimeHttpClientOptions {
  /**
   * Scope the health check to one publisher's lease instead of the most
   * recently seen lease.
   */
  publisherInstanceId?: string;
  sessionId: string;
}

/** Options for `getRuntimeSessionRetentionPlan`. */
export interface RuntimeSessionRetentionOptions
  extends RuntimeHttpClientOptions {
  /**
   * Timestamp the retention plan is evaluated at, as an ISO 8601 string.
   * Defaults to the coordinator's current time.
   */
  now?: string;
  sessionId: string;
}

/** Options for `getRuntimeMasterPlaylist`. */
export interface RuntimeMasterPlaylistOptions extends RuntimeHttpClientOptions {
  /** Live route prefix relative to `baseUrl`; defaults to `v1/live`. */
  livePath?: string;
  sessionId: string;
}

/** Options for `getRuntimeMediaPlaylist`. */
export interface RuntimeMediaPlaylistOptions
  extends RuntimeMasterPlaylistOptions {
  /** `_HLS_msn` blocking-reload parameter (media sequence number). */
  hlsMsn?: number;
  /** `_HLS_part` blocking-reload parameter (part number). */
  hlsPart?: number;
  renditionId: string;
}

/** Result of `sendRuntimePublisherHeartbeat`: the refreshed lease. */
export interface RuntimePublisherHeartbeatResponse {
  lease: RuntimePublisherLease;
  response: Response;
}

/** Result of `createRuntimeSession`: the created session's id. */
export interface RuntimeCreateSessionResponse {
  response: Response;
  sessionId: string;
}

/** Result of `transitionRuntimeSession`: the session's new state. */
export interface RuntimeTransitionSessionResponse {
  response: Response;
  sessionId: string;
  state: SessionState;
}

/** Result of `issueRuntimeSlot`: the issued upload slot. */
export interface RuntimeIssueSlotResponse {
  response: Response;
  slot: UploadSlot;
}

/** Result of `commitRuntimeUpload`. */
export interface RuntimeCommitUploadResponse {
  commit: Commit;
  /**
   * Session cursor after the commit; absent when the coordinator response
   * did not include one (for example an idempotent replay).
   */
  cursor?: Cursor;
  response: Response;
}

/** Result of `getRuntimeSessionHealth`: the resolved live health. */
export interface RuntimeSessionHealthResponse {
  health: RuntimeLiveHealth;
  response: Response;
}

/** Result of `getRuntimeSessionRetentionPlan`. */
export interface RuntimeSessionRetentionResponse {
  plan: CoordinatorRetentionPlan;
  response: Response;
}

/** Result of a playlist fetch: the raw M3U8 text. */
export interface RuntimePlaylistResponse {
  playlist: string;
  response: Response;
}

/**
 * Refresh a publisher's lease over HTTP by POSTing to the coordinator's
 * heartbeat route. Returns the validated lease from the response body.
 * Throws `RuntimeHttpError` on any non-2xx response — including 409 when the
 * session is in a terminal state.
 */
export async function sendRuntimePublisherHeartbeat(
  options: RuntimePublisherHeartbeatOptions
): Promise<RuntimePublisherHeartbeatResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, "heartbeat"),
    jsonPost({
      publisherInstanceId: options.publisherInstanceId,
    })
  );

  await assertRuntimeHttpResponseOk("publisher heartbeat", response);

  return {
    lease: leasePayload(await response.json()),
    response,
  };
}

/**
 * Create a coordinator session over HTTP by POSTing to the sessions route.
 * Throws `RuntimeHttpError` on any non-2xx response — including 409 when a
 * session with the same id already exists.
 */
export async function createRuntimeSession(
  options: RuntimeCreateSessionOptions
): Promise<RuntimeCreateSessionResponse> {
  const response = await fetchFor(options)(
    sessionsUrl(options.baseUrl),
    jsonPost({
      mediaBaseUrl: options.mediaBaseUrl,
      session: options.session,
    })
  );

  await assertRuntimeHttpResponseOk("session create", response);

  return {
    response,
    sessionId: sessionIdPayload(await response.json(), "session create"),
  };
}

/**
 * Transition a session's lifecycle state over HTTP. Throws
 * `RuntimeHttpError` on any non-2xx response — including 409 when the
 * coordinator rejects the transition as invalid from the current state.
 */
export async function transitionRuntimeSession(
  options: RuntimeTransitionSessionOptions
): Promise<RuntimeTransitionSessionResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, "transition"),
    jsonPost({ state: options.state })
  );

  await assertRuntimeHttpResponseOk("session transition", response);

  const payload = transitionPayload(await response.json());

  return {
    ...payload,
    response,
  };
}

/**
 * Issue an upload slot over HTTP. The returned slot carries the
 * coordinator-derived object key and delivery URL. Throws
 * `RuntimeHttpError` on any non-2xx response.
 */
export async function issueRuntimeSlot(
  options: RuntimeIssueSlotOptions
): Promise<RuntimeIssueSlotResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, "slots"),
    jsonPost(options.payload)
  );

  await assertRuntimeHttpResponseOk("slot issue", response);

  return {
    response,
    slot: slotPayload(await response.json()),
  };
}

/**
 * Commit an observed upload over HTTP, advancing the session's cursor.
 * Committing the same `commitId` again is idempotent on the coordinator
 * side. Throws `RuntimeHttpError` on any non-2xx response — including 409
 * when the coordinator rejects the commit.
 */
export async function commitRuntimeUpload(
  options: RuntimeCommitUploadOptions
): Promise<RuntimeCommitUploadResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, "commits"),
    jsonPost(options.payload)
  );

  await assertRuntimeHttpResponseOk("upload commit", response);

  return {
    ...commitPayload(await response.json()),
    response,
  };
}

/**
 * Fetch and validate a session's live health over HTTP. Pass
 * `publisherInstanceId` to evaluate a specific publisher's lease. Throws
 * `RuntimeHttpError` on any non-2xx response.
 */
export async function getRuntimeSessionHealth(
  options: RuntimeSessionHealthOptions
): Promise<RuntimeSessionHealthResponse> {
  const url = sessionUrl(options.baseUrl, options.sessionId, "health");

  if (options.publisherInstanceId !== undefined) {
    url.searchParams.set("publisherInstanceId", options.publisherInstanceId);
  }

  const response = await fetchFor(options)(url);

  await assertRuntimeHttpResponseOk("session health", response);

  return {
    health: healthPayload(await response.json()),
    response,
  };
}

/**
 * Fetch and validate a session's retention plan over HTTP — the expired
 * slots and retired objects eligible for cleanup at `now` (a read-only
 * preview; nothing is deleted). Throws `RuntimeHttpError` on any non-2xx
 * response.
 */
export async function getRuntimeSessionRetentionPlan(
  options: RuntimeSessionRetentionOptions
): Promise<RuntimeSessionRetentionResponse> {
  const url = sessionUrl(options.baseUrl, options.sessionId, "retention");

  if (options.now !== undefined) {
    url.searchParams.set("now", options.now);
  }

  const response = await fetchFor(options)(url);

  await assertRuntimeHttpResponseOk("session retention", response);

  return {
    plan: retentionPayload(await response.json()),
    response,
  };
}

/**
 * Fetch a session's HLS master playlist over HTTP. Throws
 * `RuntimeHttpError` on any non-2xx response.
 */
export async function getRuntimeMasterPlaylist(
  options: RuntimeMasterPlaylistOptions
): Promise<RuntimePlaylistResponse> {
  const response = await fetchFor(options)(liveUrl(options));

  await assertRuntimeHttpResponseOk("master playlist", response);

  return {
    playlist: await response.text(),
    response,
  };
}

/**
 * Fetch a rendition's HLS media playlist over HTTP. Pass `hlsMsn` /
 * `hlsPart` to issue a low-latency blocking reload; the coordinator holds
 * the response until the playlist reaches that position or its blocking
 * timeout elapses. Throws `RuntimeHttpError` on any non-2xx response.
 */
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

  await assertRuntimeHttpResponseOk("media playlist", response);

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

async function assertRuntimeHttpResponseOk(
  operation: string,
  response: Response
): Promise<void> {
  if (response.ok) {
    return;
  }

  throw new RuntimeHttpError(
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
  return requiredParsedPayload<UploadSlot>(
    value,
    "slot",
    "slot issue response must include a slot",
    parseUploadSlot
  );
}

function commitPayload(
  value: unknown
): Omit<RuntimeCommitUploadResponse, "response"> {
  return {
    commit: requiredParsedPayload<Commit>(
      value,
      "commit",
      "upload commit response must include a commit",
      parseCommit
    ),
    ...optionalCursorPayload(value),
  };
}

function optionalCursorPayload(
  value: unknown
): Pick<RuntimeCommitUploadResponse, "cursor"> | Record<string, never> {
  return optionalParsedPayload<"cursor", Cursor>(value, "cursor", parseCursor);
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
  return coordinatorRetentionPlanPayload(
    requiredRecordField(
      value,
      "plan",
      "session retention response must include a plan"
    )
  );
}

function coordinatorRetentionPlanPayload(
  value: Record<string, unknown>
): CoordinatorRetentionPlan {
  const cursor = optionalRetentionPlanCursor(value);

  return {
    expiredSlots: retentionPlanExpiredSlots(value),
    retiredObjects: retentionPlanRetiredObjects(value),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function retentionPlanExpiredSlots(
  value: Record<string, unknown>
): UploadSlot[] {
  return requiredArrayField(
    value,
    "expiredSlots",
    "runtime session retention plan must include expiredSlots"
  ).map((slot, index) => retentionPlanExpiredSlot(slot, index));
}

function retentionPlanExpiredSlot(value: unknown, index: number): UploadSlot {
  if (!isRecord(value)) {
    throw new Error(retentionPlanExpiredSlotObjectMessage(index));
  }

  try {
    return parseUploadSlot(value);
  } catch (error) {
    throw new Error(
      retentionPlanExpiredSlotValidMessage(
        index,
        errorMessage(error, String(error))
      )
    );
  }
}

function retentionPlanRetiredObjects(
  value: Record<string, unknown>
): CoordinatorRetentionPlan["retiredObjects"] {
  return requiredArrayField(
    value,
    "retiredObjects",
    "runtime session retention plan must include retiredObjects"
  ).map((retiredObject, index) =>
    retentionPlanRetiredObject(retiredObject, index)
  );
}

function retentionPlanRetiredObject(
  value: unknown,
  index: number
): CoordinatorRetentionPlan["retiredObjects"][number] {
  if (!isRecord(value)) {
    throw new Error(retentionPlanRetiredObjectObjectMessage(index));
  }

  return {
    commitId: requiredStringField(
      value,
      "commitId",
      retentionPlanRetiredObjectFieldMessage(index, "commitId")
    ),
    objectKey: requiredStringField(
      value,
      "objectKey",
      retentionPlanRetiredObjectFieldMessage(index, "objectKey")
    ),
    slotId: requiredStringField(
      value,
      "slotId",
      retentionPlanRetiredObjectFieldMessage(index, "slotId")
    ),
  };
}

function optionalRetentionPlanCursor(
  value: Record<string, unknown>
): Cursor | undefined {
  if (value.cursor === undefined) {
    return;
  }

  if (!isRecord(value.cursor)) {
    throw new Error("runtime session retention plan cursor must be an object");
  }

  return parseCursor(value.cursor);
}

function retentionPlanExpiredSlotObjectMessage(index: number): string {
  return `runtime session retention plan expiredSlots[${index}] must be an object`;
}

function retentionPlanExpiredSlotValidMessage(
  index: number,
  message: string
): string {
  return `runtime session retention plan expiredSlots[${index}] must be valid: ${message}`;
}

function retentionPlanRetiredObjectObjectMessage(index: number): string {
  return `runtime session retention plan retiredObjects[${index}] must be an object`;
}

function retentionPlanRetiredObjectFieldMessage(
  index: number,
  field: "commitId" | "objectKey" | "slotId"
): string {
  return `runtime session retention plan retiredObjects[${index}].${field} must be set`;
}

function assertRuntimeLiveHealth(
  value: unknown
): asserts value is RuntimeLiveHealth {
  if (!isRecord(value)) {
    throw new Error("runtime live health must be an object");
  }

  requiredStringLiteralField(
    value,
    "cursorFreshness",
    "session health response health must include cursorFreshness",
    HEALTH_CURSOR_FRESHNESS_VALUES,
    "session health response health.cursorFreshness must be fresh, stale, or missing"
  );
  requiredStringLiteralField(
    value,
    "status",
    "session health response health must include status",
    HEALTH_STATUS_VALUES,
    "session health response health.status must be active, stale, or starting"
  );
  assertOptionalStringLiteralField(
    value,
    "leaseStatus",
    HEALTH_LEASE_STATUS_VALUES,
    "session health response health.leaseStatus must be active or stale"
  );
  assertOptionalFiniteNumberField(
    value,
    "cursorAgeMs",
    "session health response health.cursorAgeMs must be a finite number"
  );

  if (value.publisherInstanceId !== undefined) {
    assertUrlSafeIdentifier(
      value.publisherInstanceId,
      "session health response health.publisherInstanceId"
    );
  }
}

function requiredStringLiteralField<const Allowed extends readonly string[]>(
  value: Record<string, unknown>,
  field: string,
  missingMessage: string,
  allowed: Allowed,
  invalidMessage: string
): Allowed[number] {
  const fieldValue = requiredStringField(value, field, missingMessage);

  if (!isAllowedString(fieldValue, allowed)) {
    throw new Error(invalidMessage);
  }

  return fieldValue;
}

function assertOptionalStringLiteralField<
  const Field extends string,
  const Allowed extends readonly string[],
>(
  value: Record<string, unknown>,
  field: Field,
  allowed: Allowed,
  invalidMessage: string
): void {
  const fieldValue = value[field];

  if (
    fieldValue !== undefined &&
    (typeof fieldValue !== "string" || !isAllowedString(fieldValue, allowed))
  ) {
    throw new Error(invalidMessage);
  }
}

function assertOptionalFiniteNumberField(
  value: Record<string, unknown>,
  field: string,
  invalidMessage: string
): void {
  const fieldValue = value[field];

  if (
    fieldValue !== undefined &&
    (typeof fieldValue !== "number" || !Number.isFinite(fieldValue))
  ) {
    throw new Error(invalidMessage);
  }
}

function assertSessionState(value: string): SessionState {
  if (!isAllowedString(value, SESSION_STATES)) {
    throw new Error(
      `session transition response state must be one of: ${SESSION_STATES.join(", ")}`
    );
  }

  return value;
}
