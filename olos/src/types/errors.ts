/**
 * Every error code an OLOS endpoint may return in an error body's
 * `error.code` field. Useful for exhaustive handling of runtime error
 * responses; `OlosErrorCode` (olos/types) is the derived union type.
 */
export const OLOS_ERROR_CODES = [
  "olos.invalid_session",
  "olos.invalid_state",
  "olos.unknown_slot",
  "olos.slot_expired",
  "olos.key_mismatch",
  "olos.content_type_mismatch",
  "olos.object_too_large",
  "olos.object_too_small",
  "olos.duplicate_commit_conflict",
  "olos.cursor_regression",
  "olos.provider_unavailable",
  "olos.quota_exceeded",
  "olos.security_policy_violation",
  "olos.invalid_request",
  "olos.not_found",
  "olos.method_not_allowed",
  "olos.conflict",
  "olos.internal",
] as const;

/** Machine-readable `olos.*` error code carried in every OLOS error body. */
export type OlosErrorCode = (typeof OLOS_ERROR_CODES)[number];

/**
 * Wire shape of an OLOS error response body. Dispatch on `error.code`;
 * `error.message` is human-readable and not part of the stable contract.
 */
export interface OlosError {
  error: {
    code: OlosErrorCode;
    details?: Record<string, unknown>;
    message: string;
  };
}

export function createOlosError(
  code: OlosErrorCode,
  message: string,
  details?: Record<string, unknown>
): OlosError {
  return {
    error: {
      code,
      ...(details === undefined ? {} : { details }),
      message,
    },
  };
}
