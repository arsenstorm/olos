export function jsonPostRequest(url: string, body: unknown): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export function jsonErrorTestResponse(
  message: string,
  status: number
): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    headers: { "content-type": "application/json" },
    status,
  });
}
