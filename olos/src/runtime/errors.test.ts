import { describe, expect, test } from "bun:test";
import { errorMessage } from "./errors";

describe("runtime error helpers", () => {
  test("uses Error messages", () => {
    expect(errorMessage(new Error("specific failure"), "fallback")).toBe(
      "specific failure"
    );
  });

  test("uses fallback messages for non-Error values", () => {
    expect(errorMessage("plain failure", "fallback")).toBe("fallback");
    expect(errorMessage(undefined, "fallback")).toBe("fallback");
  });
});
