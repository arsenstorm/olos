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
 * Build a fetch-style handler that serves the whole coordinator HTTP API
 * from a `CoordinatorPipelineStore`: session create/transition/heartbeat,
 * slot issue, upload commit, health, retention planning, and live master /
 * media playlists. Unknown routes get a 404 and disallowed methods a 405;
 * error responses are JSON envelopes whose `error.code` is an `olos.*`
 * code. Option validation happens eagerly — invalid options throw here, not
 * per request.
 */
export function createStoredCoordinatorRuntimeHandler(
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): StoredCoordinatorRuntimeHandler {
  assertRuntimeHandlerOptions(options);

  return async (request) => {
    // Last-resort guard: no request input may crash the handler. Expected
    // failures resolve to 4xx envelopes before reaching here; anything else
    // becomes an opaque 500 `olos.internal` envelope.
    try {
      return await handleStoredRuntimeRequest(request, options);
    } catch {
      return jsonInternalErrorResponse();
    }
  };
}

function assertRuntimeHandlerOptions(
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): void {
  assertAllowedMediaOrigins(options.allowedMediaOrigins);
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
    let url: URL;

    try {
      url = new URL(origin);
    } catch {
      throw new Error("allowedMediaOrigins must contain HTTPS origins");
    }

    if (url.protocol !== "https:" || url.origin !== origin) {
      throw new Error("allowedMediaOrigins must contain HTTPS origins");
    }
  }
}
