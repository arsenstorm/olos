import type { Session, SessionState } from "../types/session";
import { SESSION_STATES } from "../types/session";
import { assertSafeDeliveryUrl } from "../validation/delivery-url";
import {
  errorMessage,
  isAllowedString,
  isRecord,
  timestampString,
} from "../validation/fields";
import { assertSession } from "../validation/session";
import {
  type CreateStoredCoordinatorRuntimeHandlerOptions,
  defaultRuntimeNow,
  type InvalidRuntimeHttpRequestParse,
  type RuntimeHttpRequestParse,
} from "./http-types";
import { stringField, urlSafeIdentifierField } from "./request-fields";
import {
  boundedJsonRequestBody,
  isRuntimeJsonBodyTooLarge,
} from "./request-json";
import { jsonErrorResponse, jsonNotFoundResponse } from "./response";
import { routeIdentifierError } from "./route";
export async function parseSessionCreateRequest(
  request: Request,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<
  RuntimeHttpRequestParse<{
    deliveryBaseUrl: string;
    session: Session;
  }>
> {
  try {
    const payload = await boundedJsonRequestBody(request, options.maxBodyBytes);

    if (!isRecord(payload)) {
      return invalid("session create request must be a JSON object");
    }

    assertSession(payload.session);

    if (typeof payload.deliveryBaseUrl !== "string") {
      throw new Error("deliveryBaseUrl must be a string");
    }

    // Validated at parse time so a hostile URL is a 400, not a throw from
    // the pipeline constructor.
    assertSafeDeliveryUrl(payload.deliveryBaseUrl, "deliveryBaseUrl");

    return {
      deliveryBaseUrl: payload.deliveryBaseUrl,
      session: payload.session,
      status: "valid",
    };
  } catch (error) {
    return invalidParse(error, "invalid session create request");
  }
}

export async function parseTransitionRequest(
  request: Request,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<RuntimeHttpRequestParse<{ state: SessionState }>> {
  try {
    const payload = await boundedJsonRequestBody(request, options.maxBodyBytes);

    if (!isRecord(payload)) {
      return invalid("session transition request must be a JSON object");
    }

    return {
      state: sessionStateField(payload),
      status: "valid",
    };
  } catch (error) {
    return invalidParse(error, "invalid session transition request");
  }
}

export function sessionStateField(
  value: Record<string, unknown>
): SessionState {
  const state = stringField(value, "state");

  if (!isAllowedString(state, SESSION_STATES)) {
    throw new Error(`state must be one of: ${SESSION_STATES.join(", ")}`);
  }

  return state;
}

export async function parseHeartbeatRequest(
  request: Request,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): Promise<RuntimeHttpRequestParse<{ publisherInstanceId: string }>> {
  try {
    const payload = await boundedJsonRequestBody(request, options.maxBodyBytes);

    if (!isRecord(payload)) {
      return invalid("publisher heartbeat request must be a JSON object");
    }

    return {
      publisherInstanceId: urlSafeIdentifierField(
        payload,
        "publisherInstanceId"
      ),
      status: "valid",
    };
  } catch (error) {
    return invalidParse(error, "invalid publisher heartbeat request");
  }
}

export function retentionNow(
  request: Request,
  options: CreateStoredCoordinatorRuntimeHandlerOptions
): string | InvalidRuntimeHttpRequestParse {
  const queryNow = new URL(request.url).searchParams.get("now");

  if (queryNow === null) {
    return currentNow(options);
  }

  // A caller-supplied `now` is untrusted input: a malformed value is a 400
  // `olos.invalid_request`, not a throw from the retention planner.
  try {
    return timestampString(queryNow, "now");
  } catch (error) {
    return invalid(errorMessage(error, "invalid retention now"));
  }
}

export function currentNow(
  options: CreateStoredCoordinatorRuntimeHandlerOptions
) {
  if (options.now !== undefined) {
    return options.now();
  }

  if (options.clock !== undefined) {
    return options.clock();
  }

  return defaultRuntimeNow();
}

export function routeSessionIdError(
  sessionId: string | undefined
): string | undefined {
  return routeIdentifierError(
    sessionId,
    "sessionId",
    "invalid route sessionId"
  );
}

export function routePublisherInstanceIdError(
  publisherInstanceId: string | undefined
): string | undefined {
  if (publisherInstanceId === undefined) {
    return;
  }

  return routeIdentifierError(
    publisherInstanceId,
    "publisherInstanceId",
    "invalid publisherInstanceId"
  );
}

export function invalid(message: string): InvalidRuntimeHttpRequestParse {
  return { message, status: "invalid" };
}

export function invalidParse(
  error: unknown,
  fallbackMessage: string
): InvalidRuntimeHttpRequestParse {
  if (isRuntimeJsonBodyTooLarge(error)) {
    return { message: error.message, status: "too_large" };
  }

  return invalid(errorMessage(error, fallbackMessage));
}

export function notFound(): Response {
  return jsonNotFoundResponse("route not found");
}

export function sessionNotFound(): Response {
  return jsonErrorResponse(
    "olos.invalid_session",
    "coordinator session was not found",
    404
  );
}
