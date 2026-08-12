import { createStoredCoordinatorRuntimeHandler } from "../runtime/http";
import {
  jsonBadRequestResponse,
  jsonInternalErrorResponse,
  jsonMethodNotAllowedResponse,
} from "../runtime/response";
import { positiveNumber } from "../validation/fields";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { assertS3BucketName } from "./bucket";
import { type S3Route, s3Route } from "./http-route";
import {
  handleS3Commit,
  handleS3CompletionHint,
  handleS3SlotGrant,
} from "./http-routes";
import {
  handleS3Events,
  handleS3Reconciliation,
  handleS3ReconciliationPlan,
  handleS3Retention,
} from "./http-routes-events";
import type { CreateStoredS3CoordinatorRuntimeHandlerOptions } from "./http-types";
import { S3_ROUTE_ACTIONS } from "./route";

export type {
  StoredS3CoordinatorCommitResponse,
  StoredS3CoordinatorEventRouteResponse,
  StoredS3CoordinatorEventRouteResponseResult,
  StoredS3CoordinatorReconciliationResponse,
  StoredS3CoordinatorReconciliationResponseResult,
  StoredS3CoordinatorRetentionResponse,
  StoredS3CoordinatorRouteError,
  StoredS3CoordinatorSlotGrantResponse,
} from "./http-types";

/**
 * Subset of Cloudflare's ExecutionContext. When provided, the handler routes
 * retention-side S3 deletes through waitUntil so SigV4 signing CPU is paid
 * outside the request's CPU budget — essential on Workers Free's ~10 ms cap.
 */
export interface StoredS3CoordinatorRuntimeHandlerContext {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Fetch-style handler returned by
 * {@link createStoredS3CoordinatorRuntimeHandler}. Without a `ctx`, deferred
 * S3 deletes are awaited inline before the response is returned.
 */
export type StoredS3CoordinatorRuntimeHandler = (
  request: Request,
  ctx?: StoredS3CoordinatorRuntimeHandlerContext
) => Promise<Response>;

interface InvalidS3HttpRequestParse {
  message: string;
  status: "invalid";
}

export function invalid(message: string): InvalidS3HttpRequestParse {
  return { message, status: "invalid" };
}

/**
 * Create an HTTP handler that serves the S3 coordinator routes for a stored
 * session — slot grants (`s3/slots`, 201), commits and completion hints
 * (201, or 200 when idempotent), provider event ingestion (`s3/events`,
 * 202 with per-record results), reconciliation plan/apply (200/202), and
 * retention sweeps (202). Non-S3 paths fall through to the base coordinator
 * runtime handler. Error responses are JSON bodies whose `error.code` is an
 * `olos.*` code: 400 for malformed requests, 404 for unknown sessions
 * (`olos.invalid_session`), 409 for concurrency conflicts, rejections
 * mapped from their error code, and a last-resort 500 `olos.internal` for
 * unexpected throws (store I/O, corrupt snapshots). A completion hint whose
 * object `HeadObject` cannot see yet answers 409 `olos.invalid_state` — the
 * slot stays uncommitted awaiting object proof (spec §7.9). Successful
 * commits delete retired S3
 * objects as a side effect (via `ctx.waitUntil` when available), and
 * retention persists the pruned state before deleting objects. A failed
 * delete is NOT re-planned by later sweeps — the pruned state no longer
 * references it. Failures surface in the 202 response body
 * (`result.failedObjects` and the `summary`) for caller-driven retry;
 * configure a bucket lifecycle rule as the backstop for orphans. Throws
 * synchronously when `bucket`, `expiresInSeconds`, or `providerId` options
 * are invalid.
 */
export function createStoredS3CoordinatorRuntimeHandler(
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): StoredS3CoordinatorRuntimeHandler {
  assertS3HandlerOptions(options);

  const baseHandler = createStoredCoordinatorRuntimeHandler(options);

  return async (request, ctx) => {
    const route = s3Route(request, options);

    if (route.status === "not_s3") {
      return await baseHandler(request);
    }

    if (route.status === "method_not_allowed") {
      return jsonMethodNotAllowedResponse(["POST"]);
    }

    if (route.status === "invalid") {
      return jsonBadRequestResponse(route.message);
    }

    // Last-resort guard mirroring the base runtime handler: expected
    // failures resolve to olos.* envelopes inside the route handlers
    // (400 for malformed requests, mapped rejection statuses, 404/409);
    // any other throw — store I/O, a corrupt snapshot — becomes an opaque
    // 500 `olos.internal` envelope instead of escaping the fetch handler
    // as a platform error with no `error.code`.
    try {
      return await handleMatchedS3Route(request, route, options, ctx);
    } catch {
      return jsonInternalErrorResponse();
    }
  };
}

async function handleMatchedS3Route(
  request: Request,
  route: Extract<S3Route, { status: "matched" }>,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions,
  ctx: StoredS3CoordinatorRuntimeHandlerContext | undefined
): Promise<Response> {
  if (route.action === S3_ROUTE_ACTIONS.slots) {
    return await handleS3SlotGrant(request, route.sessionId, options);
  }

  if (route.action === S3_ROUTE_ACTIONS.commits) {
    return await handleS3Commit(request, route.sessionId, options, ctx);
  }

  if (route.action === "completion-hint") {
    return await handleS3CompletionHint(
      request,
      { sessionId: route.sessionId, slotId: route.slotId },
      options,
      ctx
    );
  }

  if (route.action === S3_ROUTE_ACTIONS.events) {
    return await handleS3Events(request, route.sessionId, options, ctx);
  }

  if (route.action === S3_ROUTE_ACTIONS.reconcilePlan) {
    return await handleS3ReconciliationPlan(request, route.sessionId, options);
  }

  if (route.action === S3_ROUTE_ACTIONS.retention) {
    return await handleS3Retention(request, route.sessionId, options);
  }

  return await handleS3Reconciliation(request, route.sessionId, options, ctx);
}

function assertS3HandlerOptions(
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): void {
  assertS3BucketName(options.bucket);
  positiveNumber(options.expiresInSeconds, "expiresInSeconds");

  if (options.providerId !== undefined) {
    assertUrlSafeIdentifier(options.providerId, "providerId");
  }
}
