import type { OLOS_ERROR_CODES } from "../config/errors";

export type OlosErrorCode = (typeof OLOS_ERROR_CODES)[number];

export interface OlosError {
  error: {
    code: OlosErrorCode;
    details?: Record<string, unknown>;
    message: string;
  };
}
