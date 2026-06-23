import {
  type BlockingHlsManifestArtifactResponseResolution,
  type CreateHlsManifestArtifactResponseOptions,
  createHlsManifestArtifactResponse,
  createHlsManifestErrorWebResponse,
  createHlsManifestWebResponse,
  type HlsCursorWaitContext,
  resolveBlockingHlsManifestArtifactResponse,
  resolveHlsManifestArtifactResponse,
} from "../hls";
import {
  type CreateCoordinatorManifestArtifactsOptions,
  createCoordinatorManifestArtifacts,
} from "../protocol/coordinator";

export type RuntimeManifestRequest = Request | string;

export interface ServeCoordinatorManifestOptions
  extends CreateCoordinatorManifestArtifactsOptions {
  request: RuntimeManifestRequest;
  response?: CreateHlsManifestArtifactResponseOptions;
}

export interface ServeBlockingCoordinatorManifestOptions
  extends ServeCoordinatorManifestOptions {
  timeoutMs: number;
  waitForCursor: (
    context: HlsCursorWaitContext
  ) => Promise<HlsCursorWaitContext["cursor"] | undefined>;
}

export function serveCoordinatorManifest(
  options: ServeCoordinatorManifestOptions
): Response {
  const resolved = resolveCoordinatorManifestResponse(options);

  return optionalManifestResponse(resolved);
}

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
  if (resolved.status === "invalid" || resolved.status === "not_found") {
    return createHlsManifestErrorWebResponse(resolved);
  }

  return createHlsManifestWebResponse(resolved.response);
}

function manifestNotFoundResponse(): Response {
  return createHlsManifestErrorWebResponse({ status: "not_found" });
}

function requestUrl(request: RuntimeManifestRequest): string {
  return typeof request === "string" ? request : request.url;
}
