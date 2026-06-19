export type RuntimeHttpFetch = (
  input: Request | URL | string,
  init?: RequestInit
) => Promise<Response>;

export interface RuntimeHttpClientSource {
  fetch?: RuntimeHttpFetch;
}

export function jsonPost(body: unknown): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  };
}

export function normalizedBaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

export function fetchFor(options: RuntimeHttpClientSource): RuntimeHttpFetch {
  return options.fetch ?? fetch;
}

export async function responseBody(response: Response): Promise<unknown> {
  const text = await response.clone().text();

  if (text.length === 0) {
    return;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
