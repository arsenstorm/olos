import type { ObjectKind } from "../types/storage-object";
import { parseAbsoluteHttpUrl } from "../validation/fields";
import { trimSlashes, trimTrailingSlash } from "../validation/path";

const LEADING_DOTS_PATTERN = /^\.+/;

const DEFAULT_OBJECT_KEY_PREFIX = "objects";

/** Media object kinds whose keys {@link createPublisherObjectKey} can derive. */
export type DerivableObjectKind = Extract<
  ObjectKind,
  "init" | "part" | "segment"
>;

/** Options for {@link createPublisherObjectKey}. */
export interface CreatePublisherObjectKeyOptions {
  /**
   * File extension without the dot; leading dots are stripped. Omitted,
   * the key has no extension. Profiles supply their own defaults (for
   * example `DEFAULT_MEDIA_OBJECT_EXTENSIONS` from olos/media).
   */
  extension?: string;
  kind: DerivableObjectKind;
  /**
   * Runtime nonce mixed into the file name (see
   * {@link createRuntimePublisherObjectKeyNonce}); makes the derived keys
   * unguessable. Part slots and their segment slot should share one
   * per-segment nonce so they agree on the segment object address.
   */
  objectKeyNonce?: string;
  /**
   * Leading key path component (default `objects`); surrounding slashes
   * are trimmed.
   */
  objectKeyPrefix?: string;
  /** Required when `kind` is `part`; ignored otherwise. */
  partNumber?: number;
  sequenceNumber: number;
  trackId: string;
}

/**
 * Derive the canonical object key a publisher uploads an object to.
 * Layouts, with `<prefix>` defaulting to `objects`, `[-nonce]` present
 * only when `objectKeyNonce` is set, and `[.ext]` only when `extension`
 * is set:
 *
 * - init:    `<prefix>/<trackId>/init[-nonce][.ext]`
 * - segment: `<prefix>/<trackId>/s<seq>[-nonce][.ext]`
 * - part:    `<prefix>/<trackId>/s<seq>/p<partNumber>[-nonce][.ext]`
 *
 * `<seq>` is the sequence number. Pure; throws when `kind` is `part` and
 * `partNumber` is missing.
 */
export function createPublisherObjectKey(
  options: CreatePublisherObjectKeyOptions
): string {
  const prefix = trimSlashes(
    options.objectKeyPrefix ?? DEFAULT_OBJECT_KEY_PREFIX
  );
  const extension = extensionSuffix(options.extension);

  if (options.kind === "init") {
    return createInitObjectKey(options, prefix, extension);
  }

  if (options.kind === "segment") {
    return createSegmentObjectKey(options, prefix, extension);
  }

  return createPartObjectKey(options, prefix, extension);
}

/**
 * Join an object key onto an absolute http(s) base URL to form the
 * delivery URL advertised for the object. Any query string or fragment on
 * the base URL is dropped. Pure; throws when `baseUrl` is not an absolute
 * http(s) URL.
 */
export function createPublisherDeliveryUrl(
  baseUrl: string,
  objectKey: string
): string {
  const url = parseAbsoluteHttpUrl(baseUrl, "baseUrl", {
    allowQueryOrFragment: true,
  });

  url.pathname = `${trimTrailingSlash(url.pathname)}/${objectKey}`;
  url.search = "";
  url.hash = "";

  return url.toString();
}

function extensionSuffix(extension: string | undefined): string {
  if (extension === undefined) {
    return "";
  }

  const trimmed = extension.replace(LEADING_DOTS_PATTERN, "");

  return trimmed.length === 0 ? "" : `.${trimmed}`;
}

function createInitObjectKey(
  options: CreatePublisherObjectKeyOptions,
  prefix: string,
  extension: string
): string {
  const fileName =
    options.objectKeyNonce === undefined
      ? `init${extension}`
      : `init-${options.objectKeyNonce}${extension}`;

  return `${prefix}/${options.trackId}/${fileName}`;
}

function createSegmentObjectKey(
  options: CreatePublisherObjectKeyOptions,
  prefix: string,
  extension: string
): string {
  const fileName =
    options.objectKeyNonce === undefined
      ? `s${options.sequenceNumber}${extension}`
      : `s${options.sequenceNumber}-${options.objectKeyNonce}${extension}`;

  return `${prefix}/${options.trackId}/${fileName}`;
}

function createPartObjectKey(
  options: CreatePublisherObjectKeyOptions,
  prefix: string,
  extension: string
): string {
  if (options.partNumber === undefined) {
    throw new Error('partNumber is required when kind is "part"');
  }

  const fileName =
    options.objectKeyNonce === undefined
      ? `p${options.partNumber}${extension}`
      : `p${options.partNumber}-${options.objectKeyNonce}${extension}`;

  return `${prefix}/${options.trackId}/s${options.sequenceNumber}/${fileName}`;
}
