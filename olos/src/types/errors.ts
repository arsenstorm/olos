import type { OLOS_ERROR_CODES } from "../config/errors";

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
