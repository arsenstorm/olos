import {
  assertRuntimeHttpResponseOk,
  commitPayload,
  healthPayload,
  leasePayload,
  retentionPayload,
  sessionIdPayload,
  slotPayload,
  transitionPayload,
} from "./client-payload";
import type {
  RuntimeCommitUploadOptions,
  RuntimeCommitUploadResponse,
  RuntimeCreateSessionOptions,
  RuntimeCreateSessionResponse,
  RuntimeHttpClientOptions,
  RuntimeIssueSlotOptions,
  RuntimeIssueSlotResponse,
  RuntimeMasterPlaylistOptions,
  RuntimeMediaPlaylistOptions,
  RuntimePlaylistResponse,
  RuntimePublisherHeartbeatOptions,
  RuntimePublisherHeartbeatResponse,
  RuntimeSessionHealthOptions,
  RuntimeSessionHealthResponse,
  RuntimeSessionRetentionOptions,
  RuntimeSessionRetentionResponse,
  RuntimeTransitionSessionOptions,
  RuntimeTransitionSessionResponse,
} from "./client-types";
import { fetchFor, jsonPost, normalizedBaseUrl } from "./http-client";
import { normalizedSafeRelativePath } from "./path";
import { nonNegativeInteger } from "./request-fields";
import {
  DEFAULT_LIVE_PATH,
  DEFAULT_SESSION_PATH,
  liveMasterPath,
  liveMediaPath,
  sessionRootPathFromOptions,
  sessionRoutePathFromOptions,
} from "./route";
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
    sessionUrl(options, options.sessionId, "heartbeat"),
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
    sessionsUrl(options),
    jsonPost({
      deliveryBaseUrl: options.deliveryBaseUrl,
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
    sessionUrl(options, options.sessionId, "transition"),
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
    sessionUrl(options, options.sessionId, "slots"),
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
    sessionUrl(options, options.sessionId, "commits"),
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
  const url = sessionUrl(options, options.sessionId, "health");

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
  const url = sessionUrl(options, options.sessionId, "retention");

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
 * Fetch a track's HLS media playlist over HTTP. Pass `hlsMsn` /
 * `hlsPart` to issue a low-latency blocking reload; the coordinator holds
 * the response until the playlist reaches that position or its blocking
 * timeout elapses. Throws `RuntimeHttpError` on any non-2xx response.
 */
export async function getRuntimeMediaPlaylist(
  options: RuntimeMediaPlaylistOptions
): Promise<RuntimePlaylistResponse> {
  const url = liveUrl(options, options.trackId);

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

function sessionsUrl(options: RuntimeHttpClientOptions): URL {
  const relativePath = sessionRootPathFromOptions({
    sessionPath: normalizedSessionPath(options),
  });

  return new URL(
    stripLeadingSlash(relativePath),
    normalizedBaseUrl(options.baseUrl)
  );
}

function sessionUrl(
  options: RuntimeHttpClientOptions,
  sessionId: string,
  action: string
): URL {
  const relativePath = sessionRoutePathFromOptions(sessionId, action, {
    sessionPath: normalizedSessionPath(options),
  });

  return new URL(
    stripLeadingSlash(relativePath),
    normalizedBaseUrl(options.baseUrl)
  );
}

function normalizedSessionPath(options: RuntimeHttpClientOptions): string {
  return normalizedSafeRelativePath(
    options.sessionPath ?? DEFAULT_SESSION_PATH.slice(1),
    "sessionPath"
  );
}

function liveUrl(options: RuntimeMasterPlaylistOptions, trackId?: string): URL {
  const livePath = normalizedSafeRelativePath(
    options.livePath ?? DEFAULT_LIVE_PATH.slice(1),
    "livePath"
  );

  const relativePath =
    trackId === undefined
      ? liveMasterPath(livePath, options.sessionId)
      : liveMediaPath(livePath, options.sessionId, trackId);

  return new URL(
    stripLeadingSlash(relativePath),
    normalizedBaseUrl(options.baseUrl)
  );
}

function stripLeadingSlash(path: string): string {
  return path[0] === "/" ? path.slice(1) : path;
}
