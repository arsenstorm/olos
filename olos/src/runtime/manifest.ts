import {
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
  const { request, response, ...manifestOptions } = options;
  const manifest = createCoordinatorManifestArtifacts(manifestOptions);
  const resolved = resolveHlsManifestArtifactResponse(
    manifest.artifacts.map((artifact) => ({
      ...artifact,
      response: createHlsManifestArtifactResponse(artifact, response),
    })),
    requestUrl(request)
  );

  return resolved === undefined
    ? createHlsManifestErrorWebResponse({ status: "not_found" })
    : createHlsManifestWebResponse(resolved);
}

export async function serveBlockingCoordinatorManifest(
  options: ServeBlockingCoordinatorManifestOptions
): Promise<Response> {
  const { request, response, state, timeoutMs, waitForCursor, ...manifest } =
    options;

  if (state.cursor === undefined) {
    return createHlsManifestErrorWebResponse({ status: "not_found" });
  }

  const resolved = await resolveBlockingHlsManifestArtifactResponse({
    cursor: state.cursor,
    manifest,
    requestUrl: requestUrl(request),
    response,
    session: state.session,
    timeoutMs,
    waitForCursor,
  });

  if (resolved.status === "invalid" || resolved.status === "not_found") {
    return createHlsManifestErrorWebResponse(resolved);
  }

  return createHlsManifestWebResponse(resolved.response);
}

function requestUrl(request: RuntimeManifestRequest): string {
  return typeof request === "string" ? request : request.url;
}
