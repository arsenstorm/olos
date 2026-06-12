import { describe, expect, test } from "bun:test";
import {
  createRuntimeObjectLowLatencyManifestOptions,
  createRuntimeObjectLowLatencyProfile,
  createRuntimeObjectLowLatencyPublisherOptions,
} from "./latency-profile";

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

  test("creates manifest options from object low-latency defaults", () => {
    expect(createRuntimeObjectLowLatencyManifestOptions()).toEqual({
      blockingReloadTimeoutMs: 3000,
      manifest: {
        partTarget: 0.5,
        segmentTarget: 2,
        targetLatency: 3,
      },
      response: {
        maxAgeSeconds: 1,
        targetLatencySeconds: 3,
      },
    });
  });

  test("creates publisher options from object low-latency defaults", () => {
    expect(createRuntimeObjectLowLatencyPublisherOptions()).toEqual({
      expiry: {
        minTtlSeconds: 1,
        targetLatency: 3,
      },
      publisherLeaseTtlMs: 3000,
    });
  });
});
