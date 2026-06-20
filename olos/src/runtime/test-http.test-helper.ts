export function jsonPostRequest(url: string, body: unknown): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export function rawOrJsonPostRequest(
  url: string,
  body: string | unknown
): Request {
  return new Request(url, {
    body: typeof body === "string" ? body : JSON.stringify(body),
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

export async function jsonResponseBody<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
