import type { HlsCursorWaitContext } from "../hls/blocking-reload";
import {
  type BlockingHlsManifestArtifactResponseResolution,
  type CreateCoordinatorManifestArtifactsOptions,
  type CreateHlsManifestArtifactResponseOptions,
  createCoordinatorManifestArtifacts,
  createHlsManifestArtifactResponse,
  createHlsManifestErrorWebResponse,
  createHlsManifestWebResponse,
  type HlsManifestErrorResolution,
  resolveBlockingHlsManifestArtifactResponse,
  resolveHlsManifestArtifactResponse,
} from "../hls/manifest-artifacts";

/**
 * Playlist request: a web `Request` or a plain URL string. The URL's
 * pathname selects which rendered playlist to serve; its `_HLS_msn` /
 * `_HLS_part` query parameters drive blocking reloads.
 */
export type RuntimeManifestRequest = Request | string;

/** Options for `serveCoordinatorManifest`. */
export interface ServeCoordinatorManifestOptions
  extends CreateCoordinatorManifestArtifactsOptions {
  request: RuntimeManifestRequest;
  /** Cache policy overrides for the manifest response. */
  response?: CreateHlsManifestArtifactResponseOptions;
}

/** Options for `serveBlockingCoordinatorManifest`. */
export interface ServeBlockingCoordinatorManifestOptions
  extends ServeCoordinatorManifestOptions {
  /** Max time the blocking reload is held open, in milliseconds. */
  timeoutMs: number;
  /**
   * Resolves with a newer cursor once the session advances (typically a
   * `RuntimeCursorNotifier`'s `waitForCursor`), or `undefined` on abort.
   */
  waitForCursor: (
    context: HlsCursorWaitContext
  ) => Promise<HlsCursorWaitContext["cursor"] | undefined>;
}

type ServableBlockingCoordinatorManifestResolution = Extract<
  BlockingHlsManifestArtifactResponseResolution,
  { status: "ready" | "timeout" }
>;

/**
 * Render the playlists for the given coordinator state and return the HTTP
 * response for the one matching the request URL's pathname. Returns a 404
 * when the state has no cursor yet or the path matches no playlist.
 */
export function serveCoordinatorManifest(
  options: ServeCoordinatorManifestOptions
): Response {
  const resolved = resolveCoordinatorManifestResponse(options);

  return optionalManifestResponse(resolved);
}

/**
 * Serve a media playlist with low-latency blocking reload support. When the
 * request carries `_HLS_msn` / `_HLS_part` parameters ahead of the current
 * cursor, the response is held open via `waitForCursor` until the session
 * reaches that position or `timeoutMs` (milliseconds) elapses — on timeout
 * the playlist rendered from the newest cursor is served anyway. Returns a
 * 404 when the state has no cursor yet or the path matches no playlist,
 * and a 400 for malformed reload parameters.
 */
export async function serveBlockingCoordinatorManifest(
  options: ServeBlockingCoordinatorManifestOptions
): Promise<Response> {
  if (options.state.cursor === undefined) {
    return manifestNotFoundResponse();
  }

  const resolved = await resolveBlockingHlsManifestArtifactResponse(
    blockingCoordinatorManifestResolutionOptions(options, options.state.cursor)
  );

  return blockingManifestResponse(resolved);
}

function blockingCoordinatorManifestResolutionOptions(
  options: ServeBlockingCoordinatorManifestOptions,
  cursor: NonNullable<
    ServeBlockingCoordinatorManifestOptions["state"]["cursor"]
  >
): Parameters<typeof resolveBlockingHlsManifestArtifactResponse>[0] {
  const { request, response, state, timeoutMs, waitForCursor, ...manifest } =
    options;

  return {
    cursor,
    manifest,
    requestUrl: requestUrl(request),
    response,
    session: state.session,
    timeoutMs,
    waitForCursor,
  };
}

function resolveCoordinatorManifestResponse(
  options: ServeCoordinatorManifestOptions
): ReturnType<typeof resolveHlsManifestArtifactResponse> {
  const { request, response, ...manifestOptions } = options;
  const manifest = createCoordinatorManifestArtifacts(manifestOptions);

  return resolveHlsManifestArtifactResponse(
    manifestArtifactResponses(manifest.artifacts, response),
    requestUrl(request)
  );
}

function manifestArtifactResponses(
  artifacts: ReturnType<typeof createCoordinatorManifestArtifacts>["artifacts"],
  response: CreateHlsManifestArtifactResponseOptions | undefined
) {
  return artifacts.map((artifact) => ({
    ...artifact,
    response: createHlsManifestArtifactResponse(artifact, response),
  }));
}

function optionalManifestResponse(
  resolved: ReturnType<typeof resolveHlsManifestArtifactResponse>
): Response {
  return resolved === undefined
    ? manifestNotFoundResponse()
    : createHlsManifestWebResponse(resolved);
}

function blockingManifestResponse(
  resolved: BlockingHlsManifestArtifactResponseResolution
): Response {
  if (isHlsManifestErrorResolution(resolved)) {
    return createHlsManifestErrorWebResponse(resolved);
  }

  return createHlsManifestWebResponse(resolved.response);
}

function isHlsManifestErrorResolution(
  resolved: BlockingHlsManifestArtifactResponseResolution
): resolved is HlsManifestErrorResolution {
  return !isServableBlockingCoordinatorManifestResolution(resolved);
}

function isServableBlockingCoordinatorManifestResolution(
  resolved: BlockingHlsManifestArtifactResponseResolution
): resolved is ServableBlockingCoordinatorManifestResolution {
  return resolved.status === "ready" || resolved.status === "timeout";
}

function manifestNotFoundResponse(): Response {
  return createHlsManifestErrorWebResponse({ status: "not_found" });
}

function requestUrl(request: RuntimeManifestRequest): string {
  return typeof request === "string" ? request : request.url;
}
