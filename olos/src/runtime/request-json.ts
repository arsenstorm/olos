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

  try {
    const { byteLength, chunks } = await readBoundedChunks(
      reader,
      maxBodyBytes
    );
    return new TextDecoder().decode(concatenatedChunks(chunks, byteLength));
  } finally {
    await reader.cancel().catch(() => {
      // The request body is already errored or closed; nothing to release.
    });
  }
}

/**
 * Structural view of the body reader: `request.body` carries Node's
 * `stream/web` reader type rather than the DOM one, so it is described by
 * shape. Both fields are optional because the two readers disagree on the
 * result type, so the read loop narrows `value` explicitly.
 */
interface BodyChunkReader {
  read: () => Promise<{ done?: boolean; value?: Uint8Array }>;
}

/** Drain the body, throwing as soon as it passes `maxBodyBytes`. */
async function readBoundedChunks(
  reader: BodyChunkReader,
  maxBodyBytes: number
): Promise<{ byteLength: number; chunks: readonly Uint8Array[] }> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done === true || value === undefined) {
      return { byteLength, chunks };
    }

    byteLength += value.byteLength;

    if (byteLength > maxBodyBytes) {
      throw new RuntimeJsonBodyTooLargeError();
    }

    chunks.push(value);
  }
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

export type RuntimeJsonRequestInvalidBuilder<Invalid> = (
  message: string,
  status?: "invalid" | "too_large"
) => Invalid;

export async function parseRuntimeJsonRequest<Value, Invalid>(
  request: Request | Value,
  parsePayload: (value: unknown) => Value,
  invalid: RuntimeJsonRequestInvalidBuilder<Invalid>,
  fallbackMessage: string,
  maxBodyBytes?: number
): Promise<RuntimeJsonRequestParse<Value, Invalid>> {
  if (isParsedRuntimeJsonRequestValue<Value>(request)) {
    return validRuntimeJsonRequestParse(request);
  }

  return await parsedRuntimeJsonRequestBody(
    request,
    parsePayload,
    invalid,
    fallbackMessage,
    maxBodyBytes
  );
}

async function parsedRuntimeJsonRequestBody<Value, Invalid>(
  request: Request,
  parsePayload: (value: unknown) => Value,
  invalid: RuntimeJsonRequestInvalidBuilder<Invalid>,
  fallbackMessage: string,
  maxBodyBytes?: number
): Promise<RuntimeJsonRequestParse<Value, Invalid>> {
  try {
    return validRuntimeJsonRequestParse(
      parsePayload(await boundedJsonRequestBody(request, maxBodyBytes))
    );
  } catch (error) {
    if (isRuntimeJsonBodyTooLarge(error)) {
      return invalid(error.message, "too_large");
    }

    return invalid(errorMessage(error, fallbackMessage), "invalid");
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
