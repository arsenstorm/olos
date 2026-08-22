import type { ObjectKind } from "../types/storage-object";
import { assertSafeObjectKey } from "../validation/object-key";

/**
 * File extensions (with the dot) the CMAF/LL-HLS profile accepts per
 * object kind: `.mp4` for init objects, `.m4s` for segments and parts.
 */
export const MEDIA_OBJECT_EXTENSIONS: Readonly<
  Record<ObjectKind, readonly string[]>
> = {
  init: [".mp4"],
  part: [".m4s"],
  segment: [".m4s"],
};

/**
 * Default file extension (without the dot) the profile derives object keys
 * with: `mp4` for init objects, `m4s` for segments and parts.
 */
export const DEFAULT_MEDIA_OBJECT_EXTENSIONS: Readonly<
  Record<ObjectKind, string>
> = {
  init: "mp4",
  part: "m4s",
  segment: "m4s",
};

/**
 * Validates `value` as a safe object key (see `assertSafeObjectKey`) that
 * also carries a supported CMAF extension for `kind`.
 */
export function assertSafeMediaObjectKey(
  value: unknown,
  kind: ObjectKind,
  name: string
): void {
  assertSafeObjectKey(value, name);

  if (!hasSupportedMediaObjectExtension(value, kind)) {
    throw new Error(`${name} must use a supported media extension`);
  }
}

/**
 * Validates a bare extension (without the dot) against the profile's
 * supported extensions for `kind`.
 */
export function assertSupportedMediaExtension(
  extension: string,
  kind: ObjectKind,
  name: string
): void {
  if (!MEDIA_OBJECT_EXTENSIONS[kind].includes(`.${extension}`)) {
    throw new Error(`${name} must use a supported media extension`);
  }
}

function hasSupportedMediaObjectExtension(
  objectKey: string,
  kind: ObjectKind
): boolean {
  return MEDIA_OBJECT_EXTENSIONS[kind].some((extension) =>
    objectKey.endsWith(extension)
  );
}
