import {
  createOlosError,
  type OlosError,
  type OlosErrorCode,
} from "../types/errors";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const BAD_REQUEST_STATUS = 400;
const NOT_FOUND_STATUS = 404;
const METHOD_NOT_ALLOWED_STATUS = 405;
const CONFLICT_STATUS = 409;
const METHOD_NOT_ALLOWED_MESSAGE = "method not allowed";

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": JSON_CONTENT_TYPE },
    status,
  });
}

export function jsonOlosErrorResponse(
  error: OlosError,
  status: number
): Response {
  return jsonResponse(error, status);
}

export function jsonErrorResponse(
  code: OlosErrorCode,
  message: string,
  status: number
): Response {
  return jsonOlosErrorResponse(createOlosError(code, message), status);
}

export function jsonBadRequestResponse(message: string): Response {
  return jsonErrorResponse("olos.invalid_request", message, BAD_REQUEST_STATUS);
}

export function jsonNotFoundResponse(message: string): Response {
  return jsonErrorResponse("olos.not_found", message, NOT_FOUND_STATUS);
}

export function jsonMethodNotAllowedResponse(): Response {
  return jsonErrorResponse(
    "olos.method_not_allowed",
    METHOD_NOT_ALLOWED_MESSAGE,
    METHOD_NOT_ALLOWED_STATUS
  );
}

export function jsonConflictResponse(message: string): Response {
  return jsonErrorResponse("olos.conflict", message, CONFLICT_STATUS);
}
