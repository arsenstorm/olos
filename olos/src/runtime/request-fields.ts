import type { ProfileData } from "../types/profile";
import {
  booleanValue,
  finiteNumber,
  isAllowedString,
  nonNegativeNumber,
  positiveNumber,
  stringValue,
  timestampString,
  timestampMs as validationTimestampMs,
} from "../validation/fields";
import {
  assertNonNegativeInteger,
  assertPositiveInteger,
  assertUrlSafeIdentifier,
} from "../validation/ids";
import { assertProfileData } from "../validation/profile";

export function optionalField<Key extends string, Value>(
  key: Key,
  value: Value | undefined
): Partial<Record<Key, Value>> {
  const fields: Partial<Record<Key, Value>> = {};

  if (value !== undefined) {
    fields[key] = value;
  }

  return fields;
}

/**
 * Reads an optional `profile` field as opaque profile data: when present it
 * must be a plain JSON object; its contents are the profile module's concern.
 */
export function optionalProfileField(
  value: Record<string, unknown>,
  name = "profile"
): { profile?: ProfileData } {
  if (value.profile === undefined) {
    return {};
  }

  assertProfileData(value.profile, name);

  return { profile: value.profile };
}

export function stringField(
  value: Record<string, unknown>,
  field: string
): string {
  return stringValue(value[field], field);
}

export function oneOfStringField<const Allowed extends readonly string[]>(
  value: Record<string, unknown>,
  field: string,
  allowed: Allowed
): Allowed[number] {
  const fieldValue = stringField(value, field);

  if (!isAllowedString(fieldValue, allowed)) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  }

  return fieldValue;
}

export function optionalStringField<Field extends string>(
  value: Record<string, unknown>,
  field: Field
): Partial<Record<Field, string>> {
  return optionalParsedField(value, field, stringField);
}

export function urlSafeIdentifierField(
  value: Record<string, unknown>,
  field: string
): string {
  assertUrlSafeIdentifier(value[field], field);

  return value[field];
}

export function optionalUrlSafeIdentifierValueField(
  value: Record<string, unknown>,
  field: string
): string | undefined {
  return optionalParsedValue(value, field, urlSafeIdentifierField);
}

export function numberField(
  value: Record<string, unknown>,
  field: string
): number {
  return finiteNumber(value[field], field);
}

export function booleanField(
  value: Record<string, unknown>,
  field: string
): boolean {
  return booleanValue(value[field], field);
}

export function optionalBooleanField<Field extends string>(
  value: Record<string, unknown>,
  field: Field
): Partial<Record<Field, boolean>> {
  return optionalParsedField(value, field, booleanField);
}

export function nonNegativeNumberField(
  value: Record<string, unknown>,
  field: string
): number {
  const number = numberField(value, field);

  return nonNegativeNumber(number, field);
}

export function optionalNonNegativeNumberField<Field extends string>(
  value: Record<string, unknown>,
  field: Field
): Partial<Record<Field, number>> {
  return optionalParsedField(value, field, nonNegativeNumberField);
}

export function nonNegativeIntegerField(
  value: Record<string, unknown>,
  field: string
): number {
  const number = numberField(value, field);

  return nonNegativeInteger(number, field);
}

export function optionalNonNegativeIntegerField<Field extends string>(
  value: Record<string, unknown>,
  field: Field
): Partial<Record<Field, number>> {
  return optionalParsedField(value, field, nonNegativeIntegerField);
}

export function nonNegativeInteger(value: unknown, name: string): number {
  assertNonNegativeInteger(value, name);
  return value;
}

export function nonNegativeSafeInteger(value: unknown, name: string): number {
  assertNonNegativeInteger(value, name);
  return value;
}

export function positiveIntegerField(
  value: Record<string, unknown>,
  field: string
): number {
  const number = numberField(value, field);

  return positiveInteger(number, field);
}

export function optionalPositiveIntegerField<Field extends string>(
  value: Record<string, unknown>,
  field: Field
): Partial<Record<Field, number>> {
  return optionalParsedField(value, field, positiveIntegerField);
}

export function positiveInteger(value: unknown, name: string): number {
  assertPositiveInteger(value, name);
  return value;
}

export function positiveSafeInteger(value: unknown, name: string): number {
  assertPositiveInteger(value, name);
  return value;
}

export function positiveNumberField(
  value: Record<string, unknown>,
  field: string
): number {
  const number = numberField(value, field);

  return positiveNumber(number, field);
}

export function timestampField(
  value: Record<string, unknown>,
  field: string
): string {
  return timestampString(value[field], field);
}

export function optionalTimestampField<Field extends string>(
  value: Record<string, unknown>,
  field: Field
): Partial<Record<Field, string>> {
  return optionalParsedField(value, field, timestampField);
}

export function optionalTimestampValueField(
  value: Record<string, unknown>,
  field: string
): string | undefined {
  return optionalParsedValue(value, field, timestampField);
}

function optionalParsedField<Field extends string, TValue>(
  value: Record<string, unknown>,
  field: Field,
  parse: (value: Record<string, unknown>, field: Field) => TValue
): Partial<Record<Field, TValue>> {
  if (!hasOptionalField(value, field)) {
    return {};
  }

  return optionalField(field, parse(value, field));
}

function optionalParsedValue<TValue>(
  value: Record<string, unknown>,
  field: string,
  parse: (value: Record<string, unknown>, field: string) => TValue
): TValue | undefined {
  if (!hasOptionalField(value, field)) {
    return;
  }

  return parse(value, field);
}

function hasOptionalField(
  value: Record<string, unknown>,
  field: string
): boolean {
  return value[field] !== undefined;
}

export function timestampMs(value: Date | string, name: string): number {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`${name} must be a valid timestamp`);
    }

    return value.getTime();
  }

  return validationTimestampMs(value, name);
}
