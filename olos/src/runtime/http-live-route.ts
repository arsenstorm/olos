import type { Session } from "../types/session";
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

  return await serveLiveManifest(
    liveManifestOptions(
      request,
      route.sessionId,
      snapshot.state.session,
      options
    ),
    route,
    options
  );
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
  session: Session,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
) {
  return {
    allowedMediaOrigins: options.allowedMediaOrigins,
    partTarget: session.partTarget,
    request,
    response: options.response,
    segmentTarget: session.segmentTarget,
    sessionId,
    store: options.store,
    targetLatency: options.targetLatency ?? DEFAULT_TARGET_LATENCY,
  };
}
