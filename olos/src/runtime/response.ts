export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  });
}

export function jsonErrorResponse(message: string, status: number): Response {
  return jsonResponse({ error: { message } }, status);
}

export function jsonBadRequestResponse(message: string): Response {
  return jsonErrorResponse(message, 400);
}

export function jsonMethodNotAllowedResponse(): Response {
  return jsonErrorResponse("method not allowed", 405);
}
