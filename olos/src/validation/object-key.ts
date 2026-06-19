import type { MediaObjectKind } from "../types/media-object";
import { hasControlCharacter } from "./fields";

export function isSafeObjectKey(value: unknown): value is string {
  return typeof value === "string" && safeObjectKeyError(value) === undefined;
}

export function assertSafeObjectKey(value: unknown, name: string): void {
  const error = safeObjectKeyError(value);

  if (error !== undefined) {
    throw new Error(`${name} ${error}`);
  }
}

export function assertSafeMediaObjectKey(
  value: unknown,
  kind: MediaObjectKind,
  name: string
): void {
  assertSafeObjectKey(value, name);

  if (typeof value !== "string") {
    return;
  }

  const allowedExtensions = MEDIA_OBJECT_EXTENSIONS[kind];

  if (
    allowedExtensions !== undefined &&
    !allowedExtensions.some((extension) => value.endsWith(extension))
  ) {
    throw new Error(`${name} must use a supported media extension`);
  }
}

export function assertSupportedMediaExtension(
  extension: string,
  kind: MediaObjectKind,
  name: string
): void {
  const allowedExtensions = MEDIA_OBJECT_EXTENSIONS[kind];

  if (
    allowedExtensions !== undefined &&
    !allowedExtensions.includes(`.${extension}`)
  ) {
    throw new Error(`${name} must use a supported media extension`);
  }
}

function safeObjectKeyError(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return "must be a non-empty string";
  }

  if (value.startsWith("/") || value.endsWith("/")) {
    return "must be a safe relative object key";
  }

  if (hasControlCharacter(value)) {
    return "must not contain control characters";
  }

  if (value.includes("?") || value.includes("#")) {
    return "must not contain query strings or fragments";
  }

  if (
    value
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return "must be a safe relative object key";
  }
}

const MEDIA_OBJECT_EXTENSIONS: Partial<
  Record<MediaObjectKind, readonly string[]>
> = {
  init: [".mp4"],
  part: [".m4s"],
  segment: [".m4s"],
};
