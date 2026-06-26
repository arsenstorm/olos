import { describe, expect, test } from "bun:test";
import { rejectionStatus, rejectionStatusCode } from "./rejection-status";

describe("runtime rejection status mapping", () => {
  test("maps unknown slot rejections to not found", () => {
    expect(rejectionStatusCode("olos.unknown_slot")).toBe(404);
    expect(
      rejectionStatus({
        error: {
          code: "olos.unknown_slot",
          message: "unknown slot",
        },
      })
    ).toBe(404);
  });

  test("maps other known rejections to conflict", () => {
    expect(rejectionStatusCode("olos.duplicate_commit_conflict")).toBe(409);
    expect(rejectionStatusCode("olos.provider_unavailable")).toBe(409);
    expect(rejectionStatusCode("olos.security_policy_violation")).toBe(409);
  });
});
