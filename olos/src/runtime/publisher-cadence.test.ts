import { describe, expect, test } from "bun:test";
import {
  createRuntimePublisherObjectPlanInput,
  resolveRuntimePublisherNextObjectPosition,
} from "./publisher-cadence";

describe("runtime publisher cadence", () => {
  test("starts with init when it has not been published", () => {
    expect(
      resolveRuntimePublisherNextObjectPosition({
        initPublished: false,
      })
    ).toEqual({
      kind: "init",
      mediaSequenceNumber: 0,
    });
  });

  test("resolves the next segment position", () => {
    expect(
      resolveRuntimePublisherNextObjectPosition({
        cursorWindow: {
          firstMediaSequenceNumber: 3810,
          lastMediaSequenceNumber: 3811,
        },
      })
    ).toEqual({
      kind: "segment",
      mediaSequenceNumber: 3812,
    });
  });

  test("resolves the next low-latency part position", () => {
    expect(
      resolveRuntimePublisherNextObjectPosition({
        cursorWindow: {
          firstMediaSequenceNumber: 3810,
          lastMediaSequenceNumber: 3811,
          lastPartNumber: 1,
        },
        mode: "part",
        partsPerSegment: 4,
      })
    ).toEqual({
      kind: "part",
      mediaSequenceNumber: 3811,
      partNumber: 2,
    });
  });

  test("starts the next segment after the final part", () => {
    expect(
      resolveRuntimePublisherNextObjectPosition({
        cursorWindow: {
          firstMediaSequenceNumber: 3810,
          lastMediaSequenceNumber: 3811,
          lastPartNumber: 3,
        },
        mode: "part",
        partsPerSegment: 4,
      })
    ).toEqual({
      kind: "part",
      mediaSequenceNumber: 3812,
      partNumber: 0,
    });
  });

  test("rejects invalid cadence inputs", () => {
    expect(() =>
      resolveRuntimePublisherNextObjectPosition({
        mode: "part",
      })
    ).toThrow("partsPerSegment must be a positive integer");

    expect(() =>
      resolveRuntimePublisherNextObjectPosition({
        startMediaSequenceNumber: -1,
      })
    ).toThrow("startMediaSequenceNumber must be a non-negative integer");
  });

  test("creates plan input from a resolved segment position", () => {
    expect(
      createRuntimePublisherObjectPlanInput({
        baseUrl: "https://media.example.com",
        defaults: objectDefaults,
        objectKeyPrefix: "media/session_1",
        position: {
          kind: "segment",
          mediaSequenceNumber: 3810,
        },
        publicationMode: "direct-public",
        publisherInstanceId: "publisher_1",
        renditionId: "v1080",
      })
    ).toEqual({
      baseUrl: "https://media.example.com",
      contentType: "video/mp4",
      duration: 2,
      extension: "m4s",
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKeyPrefix: "media/session_1",
      publicationMode: "direct-public",
      publisherInstanceId: "publisher_1",
      renditionId: "v1080",
    });
  });

  test("creates plan input from a resolved part position", () => {
    expect(
      createRuntimePublisherObjectPlanInput({
        baseUrl: "https://media.example.com",
        defaults: objectDefaults,
        objectKeyPrefix: "media/session_1",
        position: {
          kind: "part",
          mediaSequenceNumber: 3811,
          partNumber: 1,
        },
        publicationMode: "direct-public",
        publisherInstanceId: "publisher_1",
        renditionId: "v1080",
      })
    ).toMatchObject({
      duration: 0.5,
      extension: "m4s",
      kind: "part",
      maxBytes: 25_000,
      mediaSequenceNumber: 3811,
      minBytes: 1,
      partNumber: 1,
    });
  });
});

const objectDefaults = {
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
} as const;
