import type { ProfileData, StreamProfile } from "../types/profile";
import { assertNonEmptyStringField, isRecord } from "./fields";

/**
 * Validates an optional `profile` field as opaque profile data: when
 * present it must be a plain JSON object. Contents are the owning profile
 * module's concern.
 */
export function assertOptionalProfileField(
  value: Record<string, unknown>,
  name: string
): void {
  if (value.profile === undefined) {
    return;
  }

  assertProfileData(value.profile, `${name}.profile`);
}

/** Validates `value` as opaque profile data (a plain JSON object). */
export function assertProfileData(
  value: unknown,
  name: string
): asserts value is ProfileData {
  if (!isRecord(value) || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

/**
 * Validates `value` as a `StreamProfile`: a plain JSON object whose `id`
 * is a non-empty string naming the profile.
 */
export function assertStreamProfile(
  value: unknown,
  name: string
): asserts value is StreamProfile {
  assertProfileData(value, name);
  assertNonEmptyStringField(value, "id", name);
}
