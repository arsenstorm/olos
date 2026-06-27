import type { MediaObjectKind } from "../types/media-object";
import { parseAbsoluteHttpUrl } from "../validation/fields";

const LEADING_DOTS_PATTERN = /^\.+/;

const DEFAULT_EXTENSIONS: Record<MediaObjectKind, string> = {
  init: "mp4",
  part: "m4s",
  segment: "m4s",
};

const DEFAULT_OBJECT_KEY_PREFIX = "media";

export type DerivableMediaObjectKind = Extract<
  MediaObjectKind,
  "init" | "part" | "segment"
>;

export interface CreatePublisherObjectKeyOptions {
  extension?: string;
  kind: DerivableMediaObjectKind;
  mediaSequenceNumber: number;
  objectKeyNonce?: string;
  objectKeyPrefix?: string;
  partNumber?: number;
  renditionId: string;
}

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
      : `segment-${options.objectKeyNonce}.${extension}`;

  return options.objectKeyNonce === undefined
    ? `${prefix}/${options.renditionId}/${fileName}`
    : `${prefix}/${options.renditionId}/s${options.mediaSequenceNumber}/${fileName}`;
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

function trimSlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) === 47) {
    start += 1;
  }
  while (end > start && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return start === 0 && end === value.length ? value : value.slice(start, end);
}

function trimTrailingSlash(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}
