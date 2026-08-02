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
