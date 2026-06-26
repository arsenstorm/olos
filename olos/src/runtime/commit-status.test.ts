import { expect, test } from "bun:test";
import { isSuccessfulCommitStatus } from "./commit-status";

test("isSuccessfulCommitStatus accepts committed and idempotent statuses", () => {
  expect(isSuccessfulCommitStatus("committed")).toBe(true);
  expect(isSuccessfulCommitStatus("idempotent")).toBe(true);
});

test("isSuccessfulCommitStatus rejects non-success statuses", () => {
  expect(isSuccessfulCommitStatus("rejected")).toBe(false);
  expect(isSuccessfulCommitStatus("conflict")).toBe(false);
});
