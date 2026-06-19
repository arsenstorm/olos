import type { OlosError, OlosErrorCode } from "../types/errors";

export function rejectionStatus(error: OlosError): number {
  return rejectionStatusCode(error.error.code);
}

export function rejectionStatusCode(code: OlosErrorCode): number {
  return code === "olos.unknown_slot" ? 404 : 409;
}
