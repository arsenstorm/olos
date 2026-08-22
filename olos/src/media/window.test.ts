import { describe, expect, test } from "bun:test";
import type { CommittedSegment } from "../types/committed-window";
import {
  createMediaTrackWindowProfile,
  mediaTrackWindowProfileFor,
} from "./window";

function segment(
  sequenceNumber: number,
  discontinuityBefore?: boolean
): CommittedSegment {
  return {
    segment: {
      commitId: `commit_${sequenceNumber}`,
      deliveryUrl: `/objects/v1080/s${sequenceNumber}.m4s`,
      objectKey: `objects/v1080/s${sequenceNumber}.m4s`,
      ...(discontinuityBefore === undefined
        ? {}
        : { profile: { discontinuityBefore } }),
      slotId: `slot_${sequenceNumber}`,
    },
    sequenceNumber,
  };
}

describe("createMediaTrackWindowProfile", () => {
  test("returns no profile while nothing flagged has been trimmed", () => {
    const hook = createMediaTrackWindowProfile({ discontinuitySequence: 2 });

    expect(
      hook({
        segments: [segment(2, true)],
        trackId: "v1080",
        trimmedSegments: [segment(1)],
      })
    ).toBeUndefined();
  });

  test("adds trimmed discontinuities to the session baseline", () => {
    const hook = createMediaTrackWindowProfile({ discontinuitySequence: 2 });

    expect(
      hook({
        segments: [segment(3)],
        trackId: "v1080",
        trimmedSegments: [segment(0, true), segment(1), segment(2, true)],
      })
    ).toEqual({ discontinuitySequence: 4 });
  });

  test("defaults the baseline to zero", () => {
    const hook = createMediaTrackWindowProfile({});

    expect(
      hook({
        segments: [],
        trackId: "v1080",
        trimmedSegments: [segment(0, true)],
      })
    ).toEqual({ discontinuitySequence: 1 });
  });
});

describe("mediaTrackWindowProfileFor", () => {
  test("returns a hook only for the CMAF/LL-HLS profile", () => {
    expect(
      mediaTrackWindowProfileFor({
        id: "cmaf-llhls",
        partTarget: 0.5,
        segmentTarget: 2,
      })
    ).toBeInstanceOf(Function);
    expect(mediaTrackWindowProfileFor({ id: "telemetry" })).toBeUndefined();
  });

  test("rejects malformed media session profiles", () => {
    expect(() => mediaTrackWindowProfileFor({ id: "cmaf-llhls" })).toThrow(
      "session.profile.segmentTarget must be a positive number"
    );
  });
});
