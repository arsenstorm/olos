import type { ProfileData } from "../types/profile";

/**
 * Merge opaque profile data: `override` wins per top-level key. Returns
 * undefined when neither input contributes a key, so callers can omit the
 * `profile` field entirely instead of serializing an empty object.
 */
export function mergeProfileData(
  base: ProfileData | undefined,
  override: ProfileData | undefined
): ProfileData | undefined {
  if (base === undefined && override === undefined) {
    return;
  }

  const merged = { ...base, ...override };

  return Object.keys(merged).length === 0 ? undefined : merged;
}

/**
 * Structural equality of two opaque profile values (JSON semantics: key
 * order is irrelevant, arrays are ordered). Absent and `undefined` compare
 * equal; keys whose value is `undefined` count as absent.
 */
export function sameProfileData(first: unknown, second: unknown): boolean {
  if (first === second) {
    return true;
  }

  if (Array.isArray(first) || Array.isArray(second)) {
    return sameArray(first, second);
  }

  if (!(isPlainObject(first) && isPlainObject(second))) {
    return false;
  }

  const firstKeys = definedKeys(first);
  const secondKeys = definedKeys(second);

  return (
    firstKeys.length === secondKeys.length &&
    firstKeys.every((key) => sameProfileData(first[key], second[key]))
  );
}

function sameArray(first: unknown, second: unknown): boolean {
  return (
    Array.isArray(first) &&
    Array.isArray(second) &&
    first.length === second.length &&
    first.every((item, index) => sameProfileData(item, second[index]))
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function definedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter((key) => value[key] !== undefined);
}
