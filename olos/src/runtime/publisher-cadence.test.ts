import { describe, expect, test } from "bun:test";
import { resolveRuntimePublisherNextObjectPosition } from "./publisher-cadence";

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
});
