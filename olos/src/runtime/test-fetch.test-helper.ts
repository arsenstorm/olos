import type { RuntimeFetch } from "./client";

export function runtimeFetchFor(
  handle: (request: Request) => Promise<Response>
): RuntimeFetch {
  return (request, init) => handle(runtimeFetchRequest(request, init));
}

function runtimeFetchRequest(
  request: Parameters<RuntimeFetch>[0],
  init: Parameters<RuntimeFetch>[1]
): Request {
  return request instanceof Request
    ? request
    : new Request(String(request), init);
}
