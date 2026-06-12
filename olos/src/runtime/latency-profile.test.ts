import { describe, expect, test } from "bun:test";
import {
  createRuntimeObjectLowLatencyManifestOptions,
  createRuntimeObjectLowLatencyProfile,
  createRuntimeObjectLowLatencyPublisherDefaults,
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

  test("keeps object low-latency defaults inside the realtime budget", () => {
    const profile = createRuntimeObjectLowLatencyProfile();
    const manifest = createRuntimeObjectLowLatencyManifestOptions(profile);
    const publisher = createRuntimeObjectLowLatencyPublisherOptions(profile);

    expect(profile.targetLatency).toBeGreaterThanOrEqual(2);
    expect(profile.targetLatency).toBeLessThanOrEqual(4);
    expect(profile.partTarget).toBeLessThanOrEqual(0.5);
    expect(profile.segmentTarget).toBeLessThanOrEqual(profile.targetLatency);
    expect(profile.manifestMaxAgeSeconds).toBeLessThanOrEqual(1);
    expect(manifest.response.maxAgeSeconds).toBeLessThanOrEqual(
      profile.targetLatency
    );
    expect(manifest.blockingReloadTimeoutMs).toBe(profile.targetLatency * 1000);
    expect(publisher.expiry.targetLatency).toBe(profile.targetLatency);
    expect(publisher.publisherLeaseTtlMs).toBe(profile.targetLatency * 1000);
    expect(profile.cursorMaxAgeMs).toBe(
      (profile.targetLatency + profile.segmentTarget) * 1000
    );
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

  test("creates publisher object defaults from object low-latency settings", () => {
    expect(
      createRuntimeObjectLowLatencyPublisherDefaults({
        contentType: "video/mp4",
        init: {
          duration: 1,
          maxBytes: 2048,
        },
        part: {
          maxBytes: 25_000,
          minBytes: 1,
        },
        segment: {
          maxBytes: 100_000,
        },
      })
    ).toEqual({
      init: {
        contentType: "video/mp4",
        duration: 1,
        extension: "mp4",
        maxBytes: 2048,
      },
      part: {
        contentType: "video/mp4",
        duration: 0.5,
        extension: "m4s",
        maxBytes: 25_000,
        minBytes: 1,
      },
      segment: {
        contentType: "video/mp4",
        duration: 2,
        extension: "m4s",
        maxBytes: 100_000,
      },
    });
  });
});
