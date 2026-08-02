import type { MediaObjectKind } from "../types/media-object";
import { parseAbsoluteHttpUrl } from "../validation/fields";
import { trimSlashes, trimTrailingSlash } from "../validation/path";

const LEADING_DOTS_PATTERN = /^\.+/;

const DEFAULT_EXTENSIONS: Record<MediaObjectKind, string> = {
  init: "mp4",
  part: "m4s",
  segment: "m4s",
};

const DEFAULT_OBJECT_KEY_PREFIX = "media";

/** Media object kinds whose keys {@link createPublisherObjectKey} can derive. */
export type DerivableMediaObjectKind = Extract<
  MediaObjectKind,
  "init" | "part" | "segment"
>;

/** Options for {@link createPublisherObjectKey}. */
export interface CreatePublisherObjectKeyOptions {
  /**
   * File extension without the dot; leading dots are stripped. Defaults
   * to `mp4` for init objects and `m4s` for segments and parts.
   */
  extension?: string;
  kind: DerivableMediaObjectKind;
  mediaSequenceNumber: number;
  /**
   * Runtime nonce mixed into the file name (see
   * {@link createRuntimePublisherObjectKeyNonce}); makes the derived keys
   * unguessable. Part slots and their segment slot should share one
   * per-segment nonce so they agree on the segment object address.
   */
  objectKeyNonce?: string;
  /**
   * Leading key path component (default `media`); surrounding slashes
   * are trimmed.
   */
  objectKeyPrefix?: string;
  /** Required when `kind` is `part`; ignored otherwise. */
  partNumber?: number;
  renditionId: string;
}

/**
 * Derive the canonical object key a publisher uploads a media object to.
 * Layouts, with `<prefix>` defaulting to `media` and `[-nonce]` present
 * only when `objectKeyNonce` is set:
 *
 * - init:    `<prefix>/<renditionId>/init[-nonce].<ext>`
 * - segment: `<prefix>/<renditionId>/s<msn>[-nonce].<ext>`
 * - part:    `<prefix>/<renditionId>/s<msn>/p<partNumber>[-nonce].<ext>`
 *
 * `<msn>` is the media sequence number; `<ext>` defaults to `mp4` for
 * init objects and `m4s` for segments and parts. Pure; throws when `kind`
 * is `part` and `partNumber` is missing.
 */
export function createPublisherObjectKey(
  options: CreatePublisherObjectKeyOptions
): string {
  const prefix = trimSlashes(
    options.objectKeyPrefix ?? DEFAULT_OBJECT_KEY_PREFIX
  );
  const extension = (
    options.extension ?? DEFAULT_EXTENSIONS[options.kind]
  ).replace(LEADING_DOTS_PATTERN, "");

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

function createInitObjectKey(
  options: CreatePublisherObjectKeyOptions,
  prefix: string,
  extension: string
): string {
  const fileName =
    options.objectKeyNonce === undefined
      ? `init.${extension}`
      : `init-${options.objectKeyNonce}.${extension}`;

  return `${prefix}/${options.renditionId}/${fileName}`;
}

function createSegmentObjectKey(
  options: CreatePublisherObjectKeyOptions,
  prefix: string,
  extension: string
): string {
  const fileName =
    options.objectKeyNonce === undefined
      ? `s${options.mediaSequenceNumber}.${extension}`
      : `s${options.mediaSequenceNumber}-${options.objectKeyNonce}.${extension}`;

  return `${prefix}/${options.renditionId}/${fileName}`;
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
      ? `p${options.partNumber}.${extension}`
      : `p${options.partNumber}-${options.objectKeyNonce}.${extension}`;

  return `${prefix}/${options.renditionId}/s${options.mediaSequenceNumber}/${fileName}`;
}
