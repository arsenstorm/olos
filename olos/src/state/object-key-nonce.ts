import { assertUrlSafeIdentifier } from "../validation/ids";

/** Minimum entropy, in bytes, accepted for a runtime object key nonce. */
export const RUNTIME_PUBLISHER_OBJECT_KEY_NONCE_MIN_BYTES = 16;
const DEFAULT_OBJECT_KEY_NONCE_PREFIX = "slot";
const OBJECT_KEY_NONCE_FIELD_NAME = "objectKeyNonce";

/** Options for {@link createRuntimePublisherObjectKeyNonce}. */
export interface CreateRuntimePublisherObjectKeyNonceOptions {
  /**
   * Random bytes for the nonce; at least
   * {@link RUNTIME_PUBLISHER_OBJECT_KEY_NONCE_MIN_BYTES} are required.
   * Use a cryptographically secure source.
   */
  bytes: Uint8Array;
  /**
   * URL-safe identifier prepended to the hex digest (default `slot`).
   */
  prefix?: string;
}

/**
 * Format the nonce embedded in derived object keys (the `[-nonce]` file
 * name portion produced by `createPublisherObjectKey`) as
 * `<prefix>_<hex>`. The nonce makes upload object keys unguessable so
 * third parties cannot predict, pre-fetch, or squat on future object
 * addresses. Callers supply the randomness. Pure; throws when `bytes` is
 * not a `Uint8Array` of at least the minimum length or the prefix is not
 * a URL-safe identifier.
 */
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
  return `${prefix}_${hexEncode(bytes)}`;
}

function hexEncode(bytes: Uint8Array): string {
  let encoded = "";

  for (const byte of bytes) {
    encoded += byte.toString(16).padStart(2, "0");
  }

  return encoded;
}
