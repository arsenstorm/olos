import { errorMessage } from "../validation/fields";

const DEFAULT_MAX_JSON_BODY_BYTES = 1_048_576;
const TOO_LARGE_MESSAGE = "request body is too large";

/**
 * Thrown by `boundedJsonRequestBody` when a request body exceeds the byte
 * cap. Route handlers detect it with `isRuntimeJsonBodyTooLarge` to answer
 * 413 instead of the generic 400 parse failure.
 */
export class RuntimeJsonBodyTooLargeError extends Error {
  constructor() {
    super(TOO_LARGE_MESSAGE);
    this.name = "RuntimeJsonBodyTooLargeError";
  }
}

export function isRuntimeJsonBodyTooLarge(
  error: unknown
): error is RuntimeJsonBodyTooLargeError {
  return error instanceof RuntimeJsonBodyTooLargeError;
}

/**
 * Read and JSON-parse a request body, rejecting bodies larger than
 * `maxBodyBytes` (default 1 MiB). The declared `content-length` is checked
 * first; chunked bodies are capped while streaming, so a lying or absent
 * length header cannot buffer an unbounded payload.
 */
export async function boundedJsonRequestBody(
  request: Request,
  maxBodyBytes: number = DEFAULT_MAX_JSON_BODY_BYTES
): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw new RuntimeJsonBodyTooLargeError();
  }

  if (request.body === null) {
    return JSON.parse("");
  }

  return JSON.parse(await boundedBodyText(request.body, maxBodyBytes));
}

async function boundedBodyText(
  body: ReadableStream<Uint8Array>,
  maxBodyBytes: number
): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      byteLength += value.byteLength;

      if (byteLength > maxBodyBytes) {
        throw new RuntimeJsonBodyTooLargeError();
      }

      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {
      // The request body is already errored or closed; nothing to release.
    });
  }

  return new TextDecoder().decode(concatenatedChunks(chunks, byteLength));
}

function concatenatedChunks(
  chunks: readonly Uint8Array[],
  byteLength: number
): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

export type RuntimeJsonRequestParse<Value, Invalid> =
  | { status: "valid"; value: Value }
  | Invalid;

export async function parseRuntimeJsonRequest<Value, Invalid>(
  request: Request | Value,
  parsePayload: (value: unknown) => Value,
  invalid: (message: string) => Invalid,
  fallbackMessage: string
): Promise<RuntimeJsonRequestParse<Value, Invalid>> {
  if (isParsedRuntimeJsonRequestValue<Value>(request)) {
    return parsedRuntimeJsonRequestValue(request);
  }

  return await parsedRuntimeJsonRequestBody(
    request,
    parsePayload,
    invalid,
    fallbackMessage
  );
}

function parsedRuntimeJsonRequestValue<Value, Invalid>(
  value: Value
): RuntimeJsonRequestParse<Value, Invalid> {
  return validRuntimeJsonRequestParse(value);
}

async function parsedRuntimeJsonRequestBody<Value, Invalid>(
  request: Request,
  parsePayload: (value: unknown) => Value,
  invalid: (message: string) => Invalid,
  fallbackMessage: string
): Promise<RuntimeJsonRequestParse<Value, Invalid>> {
  try {
    return validRuntimeJsonRequestParse(
      parsePayload(await boundedJsonRequestBody(request))
    );
  } catch (error) {
    return invalid(errorMessage(error, fallbackMessage));
  }
}

function isParsedRuntimeJsonRequestValue<Value>(
  request: Request | Value
): request is Value {
  return !(request instanceof Request);
}

function validRuntimeJsonRequestParse<Value, Invalid>(
  value: Value
): RuntimeJsonRequestParse<Value, Invalid> {
  return { status: "valid", value };
}
