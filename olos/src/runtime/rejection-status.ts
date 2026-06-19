import type { OlosError } from "../types/errors";

export function rejectionStatus(error: OlosError): number {
  return error.error.code === "olos.unknown_slot" ? 404 : 409;
}
