export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  });
}

export function jsonErrorResponse(message: string, status: number): Response {
  return jsonResponse({ error: { message } }, status);
}
