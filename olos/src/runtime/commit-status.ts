import { isStringLiteral } from "./string-literals";

const SUCCESSFUL_COMMIT_STATUSES = ["committed", "idempotent"] as const;

export type SuccessfulCommitStatus =
  (typeof SUCCESSFUL_COMMIT_STATUSES)[number];

export function isSuccessfulCommitStatus(
  status: string
): status is SuccessfulCommitStatus {
  return isStringLiteral(status, SUCCESSFUL_COMMIT_STATUSES);
}
