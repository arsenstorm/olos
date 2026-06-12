import { describe, expect, test } from "bun:test";
import { createRuntimeObjectLowLatencyProfile } from "./latency-profile";

describe("runtime latency profile", () => {
  test("creates object low-latency runtime defaults", () => {
    expect(createRuntimeObjectLowLatencyProfile()).toEqual({
      blockingReloadTimeoutMs: 3000,
      cursorMaxAgeMs: 5000,
      latencyProfile: "object-ll",
      manifestMaxAgeSeconds: 1,
      minUploadTtlSeconds: 1,
      partTarget: 0.5,
      publisherLeaseTtlMs: 3000,
      segmentTarget: 2,
      targetLatency: 3,
    });
  });
});
