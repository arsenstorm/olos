import { createSerializedCoordinatorStore } from "@arsenstorm/olos/protocol";
import {
  createStoredS3CoordinatorRuntimeHandler,
  type S3GetObjectClient,
} from "@arsenstorm/olos/s3";
import { createCoordinatorStoreBackend } from "./coordinator-store";
import { createCursorWaiter } from "./cursor-notifier";
import { proxyMediaObject } from "./media-proxy";
import { R2GetObjectClient } from "./r2-get-object-client";
import { createS3Client } from "./s3-client";
import { proxyVirtualSegment } from "./virtual-segment-proxy";

// biome-ignore lint/performance/noBarrelFile: Wrangler requires the DO class to be exported from the main module
export { StreamCoordinator } from "./coordinator-do";

const BLOCKING_RELOAD_TIMEOUT_MS = 3000;
const UPLOAD_GRANT_EXPIRY_SECONDS = 5;
const PROVIDER_ID = "example_primary";
// PART-HOLD-BACK and HOLD-BACK in the rendered manifest. With a 0.5 s
// partTarget the LL-HLS spec floor for PART-HOLD-BACK is 3 × 0.5 = 1.5 s;
// going lower would tell players they can chase tighter than the spec
// allows. OLOS defaults targetLatency to 3 s — that's safe for production
// but it parks the player ~3 s behind live regardless of liveSyncDuration.
const TARGET_LATENCY_SECONDS = 1.5;

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (isPublicRoute(url.pathname) && request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    const client = createS3Client(env);
    const readClient = pickReadClient(env, client);
    const store = createSerializedCoordinatorStore(
      createCoordinatorStoreBackend(env.STREAMS)
    );

    if (request.method === "GET" && url.pathname.startsWith("/v/")) {
      return withCors(
        await proxyVirtualSegment(request, env, readClient, store)
      );
    }

    if (request.method === "GET" && url.pathname.startsWith("/media/")) {
      return withCors(await proxyMediaObject(request, env, readClient));
    }

    if (!(isPublicRoute(url.pathname) || isAuthed(request, env))) {
      return new Response("unauthorised", { status: 401 });
    }

    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: [env.MEDIA_ORIGIN],
      blockingReload: {
        timeoutMs: BLOCKING_RELOAD_TIMEOUT_MS,
        waitForCursor: createCursorWaiter(
          env.STREAMS,
          BLOCKING_RELOAD_TIMEOUT_MS
        ),
      },
      bucket: env.S3_BUCKET,
      client,
      expiresInSeconds: UPLOAD_GRANT_EXPIRY_SECONDS,
      providerId: PROVIDER_ID,
      store,
      targetLatency: TARGET_LATENCY_SECONDS,
    });

    const response = await handle(request, ctx);
    return isPublicRoute(url.pathname) ? withCors(response) : response;
  },
} satisfies ExportedHandler<Env>;

function isPublicRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/v1/live/") ||
    pathname.startsWith("/media/") ||
    pathname.startsWith("/v/")
  );
}

// Picks the GetObject path. In production set `USE_R2_BINDING=true` to read
// from the R2 binding (no AWS SigV4 CPU, slightly cheaper class B ops). In
// dev we stay on S3 because Miniflare's R2 emulator is a different bucket
// from MinIO so the binding read would always miss.
function pickReadClient(
  env: Pick<Env, "MEDIA"> & { USE_R2_BINDING: string },
  s3: ReturnType<typeof createS3Client>
): S3GetObjectClient {
  return env.USE_R2_BINDING === "true" ? new R2GetObjectClient(env.MEDIA) : s3;
}

function isAuthed(request: Request, env: Env): boolean {
  return request.headers.get("authorization") === `Bearer ${env.INGEST_KEY}`;
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-headers", "*");
  headers.set("access-control-allow-methods", "GET, OPTIONS");
  headers.set("access-control-expose-headers", "*");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
