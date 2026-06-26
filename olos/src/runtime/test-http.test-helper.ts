const JSON_CONTENT_TYPE = "application/json";
const POST_METHOD = "POST";

export function jsonPostRequest(url: string, body: unknown): Request {
  return new Request(url, {
    body: jsonBody(body),
    headers: { "content-type": JSON_CONTENT_TYPE },
    method: POST_METHOD,
  });
}

export function rawOrJsonPostRequest(
  url: string,
  body: string | unknown
): Request {
  return new Request(url, {
    body: requestBody(body),
    method: POST_METHOD,
  });
}

export function jsonErrorTestResponse(
  message: string,
  status: number
): Response {
  return new Response(jsonBody({ error: { message } }), {
    headers: { "content-type": JSON_CONTENT_TYPE },
    status,
  });
}

function requestBody(body: string | unknown): string {
  return typeof body === "string" ? body : jsonBody(body);
}

function jsonBody(body: unknown): string {
  return JSON.stringify(body);
}

export async function jsonResponseBody<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function jsonResponseStatusAndBody<T>(
  response: Response
): Promise<{ body: T; status: number }> {
  return {
    body: await jsonResponseBody<T>(response),
    status: response.status,
  };
}
