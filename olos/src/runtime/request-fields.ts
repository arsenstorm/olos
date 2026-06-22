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
  return optionalParsedField(value, field, nonNegativeIntegerField);
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
  return optionalParsedField(value, field, positiveIntegerField);
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
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);

  if (Number.isNaN(timestamp)) {
    throw new Error(`${name} must be a valid timestamp`);
  }

  return timestamp;
}
