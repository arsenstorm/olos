import type { OlosError } from "../types/errors";
import { createOlosError } from "../types/errors";

export const coordinatorError: (
  code: OlosError["error"]["code"],
  message: string,
  details?: Record<string, unknown>
) => OlosError = createOlosError;
