import { assertMediaSession } from "../media/validation";
import type { Session, Track } from "../types/session";
import { errorMessage } from "../validation/fields";
import { notFound, routeSessionIdError, sessionNotFound } from "./http-parse";
import {
  type CreateStoredCoordinatorRuntimeHandlerOptions,
  DEFAULT_TARGET_LATENCY,
  type RuntimeLiveManifestRoute,
} from "./http-types";
import {
  jsonBadRequestResponse,
  jsonMethodNotAllowedResponse,
} from "./response";
import { DEFAULT_LIVE_PATH, liveMasterPath, liveMediaPath } from "./route";
import {
  serveStoredBlockingCoordinatorManifest,
  serveStoredCoordinatorManifest,
} from "./stored";
export async function handleLiveRoute(
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

  const rejected = nonMediaSessionResponse(snapshot.state.session);

  if (rejected !== undefined) {
    return rejected;
  }

  return await serveLiveManifest(
    liveManifestOptions(request, route.sessionId, options),
    route,
    options
  );
}

/**
 * HLS playlists only exist for CMAF/LL-HLS sessions; any other profile gets
 * a clear 400 rather than a rendering failure.
 */
function nonMediaSessionResponse(session: Session): Response | undefined {
  try {
    assertMediaSession(session);
    return;
  } catch (error) {
    return jsonBadRequestResponse(
      `HLS playlists are only served for cmaf-llhls sessions: ${errorMessage(
        error,
        "session profile is not cmaf-llhls"
      )}`
    );
  }
}

/** Media playlists block when the deployment configured a reload waiter. */
function serveLiveManifest(
  manifest: ReturnType<typeof liveManifestOptions>,
  route: RuntimeLiveManifestRoute,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<Response> {
  if (route.kind === "media" && options.blockingReload !== undefined) {
    return serveStoredBlockingCoordinatorManifest({
      ...manifest,
      timeoutMs: options.blockingReload.timeoutMs,
      waitForCursor: options.blockingReload.waitForCursor,
    });
  }

  return serveStoredCoordinatorManifest(manifest);
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
  options: CreateStoredCoordinatorRuntimeHandlerOptions
) {
  const livePath = options.livePath ?? DEFAULT_LIVE_PATH;

  return {
    allowedDeliveryOrigins: options.allowedDeliveryOrigins,
    masterPath: liveMasterPath(livePath, sessionId),
    mediaPlaylistPath: (session: Session, track: Track) =>
      liveMediaPath(livePath, session.sessionId, track.trackId),
    request,
    response: options.response,
    sessionId,
    store: options.store,
    targetLatency: options.targetLatency ?? DEFAULT_TARGET_LATENCY,
  };
}
