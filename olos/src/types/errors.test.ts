import { describe, expect, test } from "bun:test";
import { createOlosError } from "./errors";

describe("createOlosError", () => {
  test("builds a minimal OLOS error", () => {
    expect(createOlosError("olos.unknown_slot", "slot not found")).toEqual({
      error: {
        code: "olos.unknown_slot",
        message: "slot not found",
      },
    });
  });

  test("builds an OLOS error with details", () => {
    expect(
      createOlosError("olos.key_mismatch", "keys do not match", {
        expected: "expected.m4s",
        observed: "observed.m4s",
      })
    ).toEqual({
      error: {
        code: "olos.key_mismatch",
        details: {
          expected: "expected.m4s",
          observed: "observed.m4s",
        },
        message: "keys do not match",
      },
    });
  });
});
