const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const BAD_REQUEST_STATUS = 400;
const METHOD_NOT_ALLOWED_STATUS = 405;
const METHOD_NOT_ALLOWED_MESSAGE = "method not allowed";

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": JSON_CONTENT_TYPE },
    status,
  });
}

export function jsonErrorResponse(message: string, status: number): Response {
  return jsonResponse({ error: { message } }, status);
}

export function jsonBadRequestResponse(message: string): Response {
  return jsonErrorResponse(message, BAD_REQUEST_STATUS);
}

export function jsonMethodNotAllowedResponse(): Response {
  return jsonErrorResponse(
    METHOD_NOT_ALLOWED_MESSAGE,
    METHOD_NOT_ALLOWED_STATUS
  );
}
