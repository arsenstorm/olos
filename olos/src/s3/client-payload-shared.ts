import {
  optionalParsedPayload,
  requiredArrayField,
  requiredRecord,
  requiredStringField,
} from "../runtime/http-client";
import type { Cursor } from "../types/cursor";
import { parseCursor } from "../validation/cursor";
import type {
  S3RuntimeOptionalCursorPayload,
  S3RuntimeRetiredObjectPayload,
  S3RuntimeSummaryCountField,
} from "./client-payload-types";

export function indexedFieldContext(context: string, index: number): string {
  return `${context}[${index}]`;
}

export function summaryCounts<const Field extends string>(
  value: Record<string, unknown>,
  fields: readonly S3RuntimeSummaryCountField<Field>[]
): Record<Field, number> {
  return Object.fromEntries(
    fields.map(({ field, message }) => [
      field,
      requiredSummaryNumber(value, field, message),
    ])
  ) as Record<Field, number>;
}

export function summaryOk(
  value: Record<string, unknown>,
  message: string
): boolean {
  return requiredSummaryBoolean(value, "ok", message);
}

export function requiredStringArrayField(
  value: Record<string, unknown>,
  field: string,
  message: string
): readonly string[] {
  const values = requiredArrayField(value, field, message);

  for (const [index, item] of values.entries()) {
    if (typeof item !== "string") {
      throw new Error(
        `${indexedFieldContext(message, index)} must be a string`
      );
    }
  }

  return values as readonly string[];
}

export function retiredObjectPayload(
  value: unknown,
  context: string
): S3RuntimeRetiredObjectPayload {
  const retired = requiredRecord(value, `${context} must be an object`);

  return {
    commitId: retiredObjectStringField(retired, "commitId", context),
    objectKey: retiredObjectStringField(retired, "objectKey", context),
    slotId: retiredObjectStringField(retired, "slotId", context),
  };
}

export function retiredObjectStringField(
  value: Record<string, unknown>,
  field: keyof S3RuntimeRetiredObjectPayload,
  context: string
): string {
  return requiredStringField(value, field, `${context}.${field} must be set`);
}

export function requiredSummaryBoolean(
  value: Record<string, unknown>,
  field: string,
  message: string
): boolean {
  if (typeof value[field] !== "boolean") {
    throw new Error(message);
  }

  return value[field];
}

export function requiredSummaryNumber(
  value: Record<string, unknown>,
  field: string,
  message: string
): number {
  if (typeof value[field] !== "number") {
    throw new Error(message);
  }

  return value[field];
}

export function optionalCursorPayload(
  value: unknown
): S3RuntimeOptionalCursorPayload {
  return optionalParsedPayload<"cursor", Cursor>(value, "cursor", parseCursor);
}
