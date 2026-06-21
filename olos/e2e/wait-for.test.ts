import { describe, expect, test } from "vitest";
import { waitFor } from "./wait-for";

describe("waitFor", () => {
  test("polls until the condition succeeds", async () => {
    let attempts = 0;

    await waitFor(
      () => {
        attempts += 1;

        return attempts === 3;
      },
      { intervalMs: 0 }
    );

    expect(attempts).toBe(3);
  });

  test("reports the polling budget when the condition does not succeed", async () => {
    await expect(
      waitFor(() => false, {
        attempts: 2,
        intervalMs: 0,
        message: "waiter was not observed",
      })
    ).rejects.toThrow(
      "waiter was not observed after 2 attempts at 0ms intervals"
    );
  });
});
