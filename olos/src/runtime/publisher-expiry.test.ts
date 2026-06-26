import { describe, expect, test } from "bun:test";
import { DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE } from "./latency-profile";
import { resolveRuntimePublisherObjectExpiry } from "./publisher-expiry";

describe("runtime publisher object expiry", () => {
  test("derives segment expiry from duration and target latency", () => {
    expect(
      resolveRuntimePublisherObjectExpiry({
        duration: 2,
        now: "2026-01-01T00:00:00.000Z",
        targetLatency: 3,
      })
    ).toEqual({
      expiresAt: "2026-01-01T00:00:05.000Z",
      ttlSeconds: 5,
    });
  });

  test("rounds part expiry up to a whole-second ttl", () => {
    expect(
      resolveRuntimePublisherObjectExpiry({
        duration: 0.5,
        now: "2026-01-01T00:00:00.000Z",
        targetLatency: 3,
      })
    ).toEqual({
      expiresAt: "2026-01-01T00:00:04.000Z",
      ttlSeconds: 4,
    });
  });

  test("honors a minimum ttl", () => {
    expect(
      resolveRuntimePublisherObjectExpiry({
        duration: 0.2,
        minTtlSeconds: 2,
        now: new Date("2026-01-01T00:00:00.000Z"),
        targetLatency: 0.3,
      })
    ).toEqual({
      expiresAt: "2026-01-01T00:00:02.000Z",
      ttlSeconds: 2,
    });
  });

  test("uses calculated ttl when it exceeds the explicit minimum", () => {
    expect(
      resolveRuntimePublisherObjectExpiry({
        duration: 2.1,
        minTtlSeconds: 1,
        now: "2026-01-01T00:00:00.000Z",
        targetLatency: 3.1,
      })
    ).toEqual({
      expiresAt: "2026-01-01T00:00:06.000Z",
      ttlSeconds: 6,
    });
  });

  test("uses exact whole-second calculated ttl values", () => {
    expect(
      resolveRuntimePublisherObjectExpiry({
        duration: 2,
        minTtlSeconds: 1,
        now: "2026-01-01T00:00:00.000Z",
        targetLatency: 3,
      }).ttlSeconds
    ).toBe(5);
  });

  test("defaults minimum ttl to low-latency profile setting", () => {
    expect(
      resolveRuntimePublisherObjectExpiry({
        duration: 0.001,
        now: "2026-01-01T00:00:00.000Z",
        targetLatency: 0.001,
      }).ttlSeconds
    ).toBe(DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE.minUploadTtlSeconds);
  });

  test("rejects invalid expiry inputs", () => {
    expect(() =>
      resolveRuntimePublisherObjectExpiry({
        duration: 0,
        now: "2026-01-01T00:00:00.000Z",
        targetLatency: 3,
      })
    ).toThrow("duration must be a positive number");

    expect(() =>
      resolveRuntimePublisherObjectExpiry({
        duration: 2,
        now: "2026-01-01T00:00:00.000Z",
        targetLatency: 0,
      })
    ).toThrow("targetLatency must be a positive number");

    expect(() =>
      resolveRuntimePublisherObjectExpiry({
        duration: 2,
        minTtlSeconds: 0,
        now: "2026-01-01T00:00:00.000Z",
        targetLatency: 3,
      })
    ).toThrow("minTtlSeconds must be a positive number");

    expect(() =>
      resolveRuntimePublisherObjectExpiry({
        duration: 2,
        now: "not-a-date",
        targetLatency: 3,
      })
    ).toThrow("now must be a valid timestamp");
  });
});
