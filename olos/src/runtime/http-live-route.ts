import { masterManifestBlockingReloadErrorResponse } from "../hls/manifest-response";
import { assertMediaSession } from "../media/validation";
import type { Cursor } from "../types/cursor";
import type { Session, Track } from "../types/session";
import { errorMessage } from "../validation/fields";
import { notFound, routeSessionIdError, sessionNotFound } from "./http-parse";
import {
  type CreateStoredCoordinatorRuntimeHandlerOptions,
  DEFAULT_TARGET_LATENCY,
  type RuntimeLiveManifestRoute,
} from "./http-types";
import {
  serveBlockingCoordinatorManifest,
  serveCoordinatorManifest,
} from "./manifest";
import {
  jsonBadRequestResponse,
  jsonMethodNotAllowedResponse,
} from "./response";
import {
  DEFAULT_LIVE_PATH,
  liveMasterPath,
  liveMediaPath,
  routeIdentifierError,
} from "./route";
import { loadCursorView } from "./stored";
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

  const routeError = routeTrackOrBlockingReloadError(request, parts, route);

  if (routeError !== undefined) {
    return routeError;
  }

  const view = await loadCursorView(options.store, route.sessionId);

  if (view === undefined) {
    return sessionNotFound();
  }

  const rejected = nonMediaSessionResponse(view.session);

  if (rejected !== undefined) {
    return rejected;
  }

  return await serveLiveManifest(
    liveManifestOptions(request, route.sessionId, options),
    route,
    options,
    view
  );
}

/**
 * Route-shape checks that don't need the session loaded: a media route's
 * `:trackId` segment must be URL-safe after percent-decoding (Spec §6.2),
 * and a master route must not carry `_HLS_msn` / `_HLS_part` (RFC 8216bis
 * §6.2.5.1).
 */
function routeTrackOrBlockingReloadError(
  request: Request,
  parts: readonly string[],
  route: RuntimeLiveManifestRoute
): Response | undefined {
  if (route.kind === "media") {
    const trackIdError = routeIdentifierError(
      parts[1],
      "trackId",
      "invalid route trackId"
    );

    return trackIdError === undefined
      ? undefined
      : jsonBadRequestResponse(trackIdError);
  }

  return masterManifestBlockingReloadErrorResponse(
    new URL(request.url).searchParams
  );
}

/**
 * HLS playlists only exist for CMAF/LL-HLS sessions; any other profile gets
 * a clear 400 rather than a rendering failure.
 */
function nonMediaSessionResponse(session: Session): Response | undefined {
  try {
    assertMediaSession(session);
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
async function serveLiveManifest(
  manifest: ReturnType<typeof liveManifestOptions>,
  route: RuntimeLiveManifestRoute,
  options: CreateStoredCoordinatorRuntimeHandlerOptions,
  view: { cursor?: Cursor; session: Session }
): Promise<Response> {
  const state = { cursor: view.cursor, session: view.session };

  if (route.kind === "media" && options.blockingReload !== undefined) {
    return await serveBlockingCoordinatorManifest({
      ...manifest,
      state,
      timeoutMs: options.blockingReload.timeoutMs,
      waitForCursor: options.blockingReload.waitForCursor,
    });
  }

  return serveCoordinatorManifest({ ...manifest, state });
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
}

function liveManifestOptions(
  request: Request,
  sessionId: string,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
) {
  const livePath = options.livePath ?? DEFAULT_LIVE_PATH;

  return {
    allowedDeliveryOrigins: options.allowedDeliveryOrigins,
    canBlockReload: options.blockingReload !== undefined,
    masterPath: liveMasterPath(livePath, sessionId),
    mediaPlaylistPath: (session: Session, track: Track) =>
      liveMediaPath(livePath, session.sessionId, track.trackId),
    request,
    response: options.response,
    targetLatency: options.targetLatency ?? DEFAULT_TARGET_LATENCY,
  };
}
