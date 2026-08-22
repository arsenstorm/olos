import type { OlosError } from "../types/errors";
import { OLOS_ERROR_CODES } from "../types/errors";
import {
  assertKnownFieldsObject,
  assertNonEmptyStringField,
  assertOneOfField,
  isRecord,
  passes,
} from "./fields";

const OLOS_ERROR_ENVELOPE_FIELDS = ["code", "details", "message"] as const;

/** Returns whether `value` is a valid error envelope (see the assert). */
export function isOlosErrorEnvelope(value: unknown): value is OlosError {
  return passes(assertOlosErrorEnvelope, value);
}

/**
 * Validates an untrusted value as a protocol error envelope (spec §3.10):
 * an `error` object whose `code` is a registered `olos.*` code, whose
 * `message` is a non-empty string, and whose optional `details` is an
 * object. Unknown fields are rejected, matching `OLOS_ERROR_SCHEMA`.
 */
export function assertOlosErrorEnvelope(
  value: unknown
): asserts value is OlosError {
  assertKnownFieldsObject(value, ["error"], "olosError");
  assertKnownFieldsObject(
    value.error,
    OLOS_ERROR_ENVELOPE_FIELDS,
    "olosError.error"
  );
  assertOneOfField(value.error, "code", OLOS_ERROR_CODES, "olosError.error");
  assertNonEmptyStringField(value.error, "message", "olosError.error");

  if (value.error.details !== undefined && !isRecord(value.error.details)) {
    throw new Error("olosError.error.details must be an object");
  }
}
