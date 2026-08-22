import { describe, expect, test } from "bun:test";
import { createHlsManifestArtifacts } from "../hls/manifest-artifacts";
import { testCoordinatorSession as session } from "../protocol/coordinator-state.test-helper";
import type { CommittedWindow } from "../types/committed-window";
import {
  createRuntimeObjectLowLatencyManifestOptions,
  createRuntimeObjectLowLatencyProfile,
  createRuntimeObjectLowLatencyPublisherDefaults,
  createRuntimeObjectLowLatencyPublisherOptions,
  DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE,
} from "./latency-profile";

const mediaOrigin = "https://media.example.com";

const committedWindow: CommittedWindow = {
  epoch: 1,
  firstSequenceNumber: 3810,
  lastSequenceNumber: 3810,
  tracks: {
    v1080: {
      init: {
        commitId: "commit_init",
        deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
        objectKey: "media/v1080/init.mp4",
        slotId: "slot_init",
      },
      trackId: "v1080",
      segments: [
        {
          sequenceNumber: 3810,
          segment: {
            commitId: "commit_3810",
            deliveryUrl: "https://media.example.com/media/3810.m4s",
            objectKey: "media/3810.m4s",
            profile: { duration: 2 },
            slotId: "slot_3810",
          },
        },
      ],
    },
  },
};

describe("media latency profile", () => {
  test("creates object low-latency runtime defaults", () => {
    expect(DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE).toEqual({
      blockingReloadTimeoutMs: 3000,
      cursorMaxAgeMs: 5000,
      manifestMaxAgeSeconds: 1,
      minUploadTtlSeconds: 1,
      partHoldBack: 3,
      partTarget: 0.5,
      publisherLeaseTtlMs: 3000,
      segmentTarget: 2,
      targetLatency: 3,
    });
    expect(createRuntimeObjectLowLatencyProfile()).toEqual(
      DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE
    );
  });

  test("returns a fresh mutable copy of object low-latency defaults", () => {
    const first = createRuntimeObjectLowLatencyProfile();
    const second = createRuntimeObjectLowLatencyProfile();

    first.targetLatency = 4;

    expect(second.targetLatency).toBe(
      DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE.targetLatency
    );
    expect(DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE.targetLatency).toBe(3);
  });

  test("keeps object low-latency defaults inside the realtime budget", () => {
    const profile = createRuntimeObjectLowLatencyProfile();
    const manifest = createRuntimeObjectLowLatencyManifestOptions(profile);
    const publisher = createRuntimeObjectLowLatencyPublisherOptions(profile);

    expect(profile.targetLatency).toBeGreaterThanOrEqual(2);
    expect(profile.targetLatency).toBeLessThanOrEqual(4);
    expect(profile.partTarget).toBeLessThanOrEqual(0.5);
    expect(profile.partHoldBack).toBeGreaterThanOrEqual(3 * profile.partTarget);
    expect(profile.partHoldBack).toBe(profile.targetLatency);
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
        partHoldBack: 3,
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

  test("renders manifests with object low-latency hold-backs", () => {
    const options = createRuntimeObjectLowLatencyManifestOptions();
    const artifacts = createHlsManifestArtifacts(session, committedWindow, {
      allowedDeliveryOrigins: [mediaOrigin],
      ...options.manifest,
    });
    const media = artifacts.find((artifact) =>
      artifact.path.endsWith("/media.m3u8")
    );

    expect(media?.body).toContain("PART-HOLD-BACK=3.000,HOLD-BACK=6.000");
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
        cadenceSeconds: 1,
        contentType: "video/mp4",
        extension: "mp4",
        maxBytes: 2048,
        profile: { duration: 1 },
      },
      part: {
        cadenceSeconds: 0.5,
        contentType: "video/mp4",
        extension: "m4s",
        maxBytes: 25_000,
        minBytes: 1,
        profile: { duration: 0.5 },
      },
      segment: {
        cadenceSeconds: 2,
        contentType: "video/mp4",
        extension: "m4s",
        maxBytes: 100_000,
        profile: { duration: 2 },
      },
    });
  });

  test("rejects unsupported media extensions in publisher object defaults", () => {
    expect(() =>
      createRuntimeObjectLowLatencyPublisherDefaults({
        contentType: "video/mp4",
        init: {
          duration: 1,
          maxBytes: 2048,
        },
        part: {
          extension: "html",
          maxBytes: 25_000,
        },
        segment: {
          maxBytes: 100_000,
        },
      })
    ).toThrow("extension must use a supported media extension");
  });

  test("allows zero minimum bytes in publisher object defaults", () => {
    expect(
      createRuntimeObjectLowLatencyPublisherDefaults({
        contentType: "video/mp4",
        init: {
          duration: 1,
          maxBytes: 2048,
          minBytes: 0,
        },
        part: {
          maxBytes: 25_000,
        },
        segment: {
          maxBytes: 100_000,
        },
      }).init.minBytes
    ).toBe(0);
  });

  test("rejects invalid publisher object defaults", () => {
    expect(() =>
      createRuntimeObjectLowLatencyPublisherDefaults({
        contentType: "",
        init: {
          duration: 1,
          maxBytes: 2048,
        },
        part: {
          maxBytes: 25_000,
        },
        segment: {
          maxBytes: 100_000,
        },
      })
    ).toThrow("contentType must be a non-empty string");

    expect(() =>
      createRuntimeObjectLowLatencyPublisherDefaults({
        contentType: "video/mp4",
        init: {
          duration: 0,
          maxBytes: 2048,
        },
        part: {
          maxBytes: 25_000,
        },
        segment: {
          maxBytes: 100_000,
        },
      })
    ).toThrow("duration must be a positive number");

    expect(() =>
      createRuntimeObjectLowLatencyPublisherDefaults({
        contentType: "video/mp4",
        init: {
          duration: 1,
          maxBytes: 2048,
        },
        part: {
          maxBytes: 0,
        },
        segment: {
          maxBytes: 100_000,
        },
      })
    ).toThrow("maxBytes must be a positive integer");

    expect(() =>
      createRuntimeObjectLowLatencyPublisherDefaults({
        contentType: "video/mp4",
        init: {
          duration: 1,
          maxBytes: 2048,
        },
        part: {
          maxBytes: 25_000,
          minBytes: 25_001,
        },
        segment: {
          maxBytes: 100_000,
        },
      })
    ).toThrow("minBytes must be a non-negative integer up to maxBytes");
  });
});
