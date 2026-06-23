import { assertUrlSafeIdentifier } from "../validation/ids";

export const RUNTIME_PUBLISHER_OBJECT_KEY_NONCE_MIN_BYTES = 16;
const DEFAULT_OBJECT_KEY_NONCE_PREFIX = "slot";
const OBJECT_KEY_NONCE_FIELD_NAME = "objectKeyNonce";

export interface CreateRuntimePublisherObjectKeyNonceOptions {
  bytes: Uint8Array;
  prefix?: string;
}

export function createRuntimePublisherObjectKeyNonce(
  options: CreateRuntimePublisherObjectKeyNonceOptions
): string {
  assertObjectKeyNonceBytes(options.bytes);

  const prefix = resolveObjectKeyNoncePrefix(options.prefix);

  return formatObjectKeyNonce(prefix, options.bytes);
}

function assertObjectKeyNonceBytes(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error(
      `${OBJECT_KEY_NONCE_FIELD_NAME} bytes must be a Uint8Array`
    );
  }

  if (bytes.byteLength < RUNTIME_PUBLISHER_OBJECT_KEY_NONCE_MIN_BYTES) {
    throw new Error(
      `${OBJECT_KEY_NONCE_FIELD_NAME} bytes must contain at least ${RUNTIME_PUBLISHER_OBJECT_KEY_NONCE_MIN_BYTES} bytes`
    );
  }
}

function resolveObjectKeyNoncePrefix(prefix: string | undefined): string {
  const resolvedPrefix = prefix ?? DEFAULT_OBJECT_KEY_NONCE_PREFIX;
  assertUrlSafeIdentifier(
    resolvedPrefix,
    `${OBJECT_KEY_NONCE_FIELD_NAME} prefix`
  );

  return resolvedPrefix;
}

function formatObjectKeyNonce(prefix: string, bytes: Uint8Array): string {
  return `${prefix}_${toHex(bytes)}`;
}

function toHex(bytes: Uint8Array): string {
  let value = "";

  for (const byte of bytes) {
    value += byte.toString(16).padStart(2, "0");
  }

  return value;
}
