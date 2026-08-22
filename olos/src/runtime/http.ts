import { mediaCommitPolicy } from "../media/commit-policy";
import { positiveMutationAttempts } from "../protocol/mutate-coordinator-store";
import { nonNegativeNumber, positiveNumber } from "../validation/fields";
import { handleStoredRuntimeRequest } from "./http-session-routes";
import type {
  CreateStoredCoordinatorRuntimeHandlerOptions,
  StoredCoordinatorRuntimeHandler,
} from "./http-types";
import { jsonInternalErrorResponse } from "./response";
import {
  assertRoutePath,
  DEFAULT_LIVE_PATH,
  DEFAULT_SESSION_PATH,
} from "./route";
/**
 * Apply the handler option defaults that depend on a profile module:
 * `commitPolicy` falls back to `mediaCommitPolicy` (olos/media). Exported so
 * wrapping handlers (the S3 handler) apply the same defaults to the routes
 * they serve themselves.
 */
export function resolveStoredCoordinatorRuntimeHandlerOptions<
  Options extends CreateStoredCoordinatorRuntimeHandlerOptions,
>(options: Options): Options {
  return {
    ...options,
    commitPolicy: options.commitPolicy ?? mediaCommitPolicy,
  };
}

/**
 * Build a fetch-style handler that serves the whole coordinator HTTP API
 * from a `CoordinatorPipelineStore`: session create/transition/heartbeat,
 * slot issue, upload commit, health, retention planning, and live master /
 * media playlists. Unknown routes get a 404 and disallowed methods a 405;
 * error responses are JSON envelopes whose `error.code` is an `olos.*`
 * code. Option validation happens eagerly — invalid options throw here, not
 * per request. `commitPolicy` defaults to `mediaCommitPolicy` (olos/media)
 * when unset, so CMAF/LL-HLS sessions get its profile-aware duration checks.
 */
export function createStoredCoordinatorRuntimeHandler(
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): StoredCoordinatorRuntimeHandler {
  assertRuntimeHandlerOptions(options);

  const resolved = resolveStoredCoordinatorRuntimeHandlerOptions(options);

  return async (request) => {
    // Last-resort guard: no request input may crash the handler. Expected
    // failures resolve to 4xx envelopes before reaching here; anything else
    // becomes an opaque 500 `olos.internal` envelope.
    try {
      return await handleStoredRuntimeRequest(request, resolved);
    } catch {
      return jsonInternalErrorResponse();
    }
  };
}

function assertRuntimeHandlerOptions(
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): void {
  assertAllowedMediaOrigins(options.allowedDeliveryOrigins);
  assertRoutePath(options.sessionPath ?? DEFAULT_SESSION_PATH, "sessionPath");
  assertRoutePath(options.livePath ?? DEFAULT_LIVE_PATH, "livePath");

  positiveMutationAttempts(options.maxAttempts);

  if (options.targetLatency !== undefined) {
    positiveNumber(options.targetLatency, "targetLatency");
  }

  if (options.maxHealthCursorAgeMs !== undefined) {
    positiveNumber(options.maxHealthCursorAgeMs, "maxHealthCursorAgeMs");
  }

  if (options.publisherLeaseTtlMs !== undefined) {
    positiveNumber(options.publisherLeaseTtlMs, "publisherLeaseTtlMs");
  }

  if (options.lateToleranceMs !== undefined) {
    nonNegativeNumber(options.lateToleranceMs, "lateToleranceMs");
  }

  if (options.blockingReload !== undefined) {
    nonNegativeNumber(
      options.blockingReload.timeoutMs,
      "blockingReload.timeoutMs"
    );
  }

  if (options.maxBodyBytes !== undefined) {
    positiveNumber(options.maxBodyBytes, "maxBodyBytes");
  }
}

function assertAllowedMediaOrigins(origins: readonly string[]): void {
  for (const origin of origins) {
    if (!isHttpsOrigin(origin)) {
      throw new Error("allowedDeliveryOrigins must contain HTTPS origins");
    }
  }
}

function isHttpsOrigin(origin: string): boolean {
  let url: URL;

  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  return url.protocol === "https:" && url.origin === origin;
}
