import {
  type BlockingHlsManifestArtifactResponseResolution,
  type CreateHlsManifestArtifactResponseOptions,
  createHlsManifestArtifactResponse,
  createHlsManifestErrorWebResponse,
  createHlsManifestWebResponse,
  type HlsCursorWaitContext,
  type HlsManifestErrorResolution,
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

type ServableBlockingCoordinatorManifestResolution = Extract<
  BlockingHlsManifestArtifactResponseResolution,
  { status: "ready" | "timeout" }
>;

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
