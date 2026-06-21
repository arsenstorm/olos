import {
  booleanValue,
  finiteNumber,
  isAllowedString,
  isRecord as isValidationRecord,
  stringValue,
  timestampString,
  nonNegativeNumber as validationNonNegativeNumber,
  positiveNumber as validationPositiveNumber,
  recordValue as validationRecordValue,
} from "../validation/fields";
import {
  assertNonNegativeInteger,
  assertNonNegativeSafeInteger,
  assertPositiveInteger,
  assertPositiveSafeInteger,
  assertUrlSafeIdentifier,
} from "../validation/ids";
import { optionalField } from "./optional-field";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return isValidationRecord(value);
}

export function recordValue(
  value: unknown
): Record<string, unknown> | undefined {
  return validationRecordValue(value);
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
  if (value[field] === undefined) {
    return {};
  }

  return optionalField(field, stringField(value, field));
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
  if (value[field] === undefined) {
    return;
  }

  return urlSafeIdentifierField(value, field);
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
  if (value[field] === undefined) {
    return {};
  }

  return optionalField(field, booleanField(value, field));
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
  if (value[field] === undefined) {
    return {};
  }

  return optionalField(field, nonNegativeNumberField(value, field));
}

export function nonNegativeNumber(value: number, name: string): number {
  return validationNonNegativeNumber(value, name);
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
  if (value[field] === undefined) {
    return {};
  }

  return optionalField(field, nonNegativeIntegerField(value, field));
}

export function nonNegativeInteger(value: unknown, name: string): number {
  assertNonNegativeInteger(value, name);
  return value;
}

export function nonNegativeSafeInteger(value: unknown, name: string): number {
  assertNonNegativeSafeInteger(value, name);
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
  if (value[field] === undefined) {
    return {};
  }

  return optionalField(field, positiveIntegerField(value, field));
}

export function positiveInteger(value: unknown, name: string): number {
  assertPositiveInteger(value, name);
  return value;
}

export function positiveSafeInteger(value: unknown, name: string): number {
  assertPositiveSafeInteger(value, name);
  return value;
}

export function positiveNumberField(
  value: Record<string, unknown>,
  field: string
): number {
  const number = numberField(value, field);

  return positiveNumber(number, field);
}

export function positiveNumber(value: number, name: string): number {
  return validationPositiveNumber(value, name);
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
  if (value[field] === undefined) {
    return {};
  }

  return optionalField(field, timestampField(value, field));
}

export function optionalTimestampValueField(
  value: Record<string, unknown>,
  field: string
): string | undefined {
  if (value[field] === undefined) {
    return;
  }

  return timestampField(value, field);
}

export function timestampMs(value: Date | string, name: string): number {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);

  if (Number.isNaN(timestamp)) {
    throw new Error(`${name} must be a valid timestamp`);
  }

  return timestamp;
}
