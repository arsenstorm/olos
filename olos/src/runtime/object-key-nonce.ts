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
  if (!(options.bytes instanceof Uint8Array)) {
    throw new Error(
      `${OBJECT_KEY_NONCE_FIELD_NAME} bytes must be a Uint8Array`
    );
  }

  if (options.bytes.byteLength < RUNTIME_PUBLISHER_OBJECT_KEY_NONCE_MIN_BYTES) {
    throw new Error(
      `${OBJECT_KEY_NONCE_FIELD_NAME} bytes must contain at least ${RUNTIME_PUBLISHER_OBJECT_KEY_NONCE_MIN_BYTES} bytes`
    );
  }

  const prefix = options.prefix ?? DEFAULT_OBJECT_KEY_NONCE_PREFIX;
  assertUrlSafeIdentifier(prefix, `${OBJECT_KEY_NONCE_FIELD_NAME} prefix`);

  return `${prefix}_${toHex(options.bytes)}`;
}

function toHex(bytes: Uint8Array): string {
  let value = "";

  for (const byte of bytes) {
    value += byte.toString(16).padStart(2, "0");
  }

  return value;
}
