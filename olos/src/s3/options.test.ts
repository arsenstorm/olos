import { describe, expect, test } from "bun:test";
import { assertPositiveExpiresInSeconds } from "./options";

describe("S3 option validation", () => {
  test("accepts positive expiration windows", () => {
    expect(() => assertPositiveExpiresInSeconds(30)).not.toThrow();
  });

  test("rejects non-positive expiration windows", () => {
    expect(() => assertPositiveExpiresInSeconds(0)).toThrow(
      "expiresInSeconds must be a positive number"
    );
    expect(() => assertPositiveExpiresInSeconds(-1)).toThrow(
      "expiresInSeconds must be a positive number"
    );
  });
});
