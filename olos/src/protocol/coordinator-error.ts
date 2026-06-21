import type { OlosError } from "../types/errors";

export function coordinatorError(
  code: OlosError["error"]["code"],
  message: string,
  details: Record<string, unknown>
): OlosError {
  return {
    error: {
      code,
      details,
      message,
    },
  };
}
