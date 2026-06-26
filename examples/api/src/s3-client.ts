import { S3Client } from "@aws-sdk/client-s3";

// The AWS SDK's browser stream collector (in @smithy/fetch-http-handler)
// tests `stream instanceof Blob || stream.constructor?.name === "Blob"`
// before reaching for `getReader()`. In workerd that test fails for the
// Blob returned by `response.blob()` on HEAD-style responses (cross-realm
// constructor identity), so the collector falls through to a `getReader`
// call that doesn't exist on a Blob. This replacement handles either a
// Blob (`.arrayBuffer`) or a ReadableStream (`.getReader`) explicitly.
async function streamCollector(stream: unknown): Promise<Uint8Array> {
  if (stream == null) {
    return new Uint8Array();
  }
  if (typeof (stream as Blob | undefined)?.arrayBuffer === "function") {
    return new Uint8Array(await (stream as Blob).arrayBuffer());
  }
  if (
    typeof (stream as ReadableStream<Uint8Array> | undefined)?.getReader ===
    "function"
  ) {
    return await collectReadableStream(stream as ReadableStream<Uint8Array>);
  }
  return await collectAsyncIterable(
    stream as AsyncIterable<Uint8Array | string>
  );
}

async function collectReadableStream(
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    length += value.length;
  }
  return concatChunks(chunks, length);
}

async function collectAsyncIterable(
  stream: AsyncIterable<Uint8Array | string>
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const encoder = new TextEncoder();
  for await (const chunk of stream) {
    const buffer = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
    chunks.push(buffer);
    length += buffer.length;
  }
  return concatChunks(chunks, length);
}

function concatChunks(
  chunks: readonly Uint8Array[],
  length: number
): Uint8Array {
  const collected = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    collected.set(chunk, offset);
    offset += chunk.length;
  }
  return collected;
}

export function createS3Client(env: Env): S3Client {
  return new S3Client({
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    endpoint: env.S3_ENDPOINT_URL,
    forcePathStyle: true,
    region: env.S3_REGION,
    streamCollector,
  });
}
