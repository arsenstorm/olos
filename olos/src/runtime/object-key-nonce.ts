import { assertUrlSafeIdentifier } from "../validation/ids";

export const RUNTIME_PUBLISHER_OBJECT_KEY_NONCE_MIN_BYTES = 16;

export interface CreateRuntimePublisherObjectKeyNonceOptions {
  bytes: Uint8Array;
  prefix?: string;
}

export function createRuntimePublisherObjectKeyNonce(
  options: CreateRuntimePublisherObjectKeyNonceOptions
): string {
  if (!(options.bytes instanceof Uint8Array)) {
    throw new Error("objectKeyNonce bytes must be a Uint8Array");
  }

  if (options.bytes.byteLength < RUNTIME_PUBLISHER_OBJECT_KEY_NONCE_MIN_BYTES) {
    throw new Error("objectKeyNonce bytes must contain at least 16 bytes");
  }

  const prefix = options.prefix ?? "slot";
  assertUrlSafeIdentifier(prefix, "objectKeyNonce prefix");

  return `${prefix}_${toHex(options.bytes)}`;
}

function toHex(bytes: Uint8Array): string {
  let value = "";

  for (const byte of bytes) {
    value += byte.toString(16).padStart(2, "0");
  }

  return value;
}
