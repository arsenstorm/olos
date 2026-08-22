import type { OlosErrorCode } from "../types/errors";

const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const NOT_FOUND_ERROR_CODES: readonly OlosErrorCode[] = ["olos.unknown_slot"];

export function rejectionStatusCode(code: OlosErrorCode): number {
  return NOT_FOUND_ERROR_CODES.includes(code) ? HTTP_NOT_FOUND : HTTP_CONFLICT;
}
