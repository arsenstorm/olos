import { describe, expect, test } from "bun:test";
import type { Cursor } from "../types/cursor";
import { assertCursor, isCursor, parseCursor } from "./cursor";

const validCursor: Cursor = {
  committedWindow: {
    epoch: 4,
    firstSequenceNumber: 3810,
    lastSequenceNumber: 3811,
    tracks: {
      v1080: {
        init: {
          commitId: "commit_init",
          deliveryUrl: "/media/v1080/init.mp4",
          objectKey: "tenant/session/v1080/init.mp4",
          slotId: "slot_init",
        },
        trackId: "v1080",
        segments: [
          {
            sequenceNumber: 3810,
            segment: {
              commitId: "commit_3810",
              deliveryUrl: "/media/3810.m4s",
              objectKey: "tenant/session/v1080/3810.m4s",
              slotId: "slot_3810",
              profile: { duration: 1 },
            },
          },
          {
            sequenceNumber: 3811,
            segment: {
              commitId: "commit_3811",
              deliveryUrl: "/media/3811.m4s",
              objectKey: "tenant/session/v1080/3811.m4s",
              slotId: "slot_3811",
              profile: { duration: 1 },
            },
          },
        ],
      },
    },
  },
  epoch: 4,
  deliveryBaseUrl: "https://media.example.com",
  olos: "1.0",
  profile: { id: "cmaf-llhls", partTarget: 0.333, segmentTarget: 1 },
  sessionId: "session_1",
  state: "live",
  updatedAt: "2026-06-08T12:00:01.820Z",
  window: {
    firstSequenceNumber: 3810,
    lastSequenceNumber: 3811,
  },
};

const validTrack = validCursor.committedWindow.tracks.v1080;

if (validTrack === undefined) {
  throw new Error("missing v1080 fixture");
}

const cursorWithVisibleParts: Cursor = {
  ...validCursor,
  committedWindow: {
    ...validCursor.committedWindow,
    tracks: {
      v1080: {
        ...validTrack,
        segments: [
          ...validTrack.segments.slice(0, 1),
          {
            sequenceNumber: 3811,
            parts: [
              {
                commitId: "commit_3811_p0",
                deliveryUrl: "/media/3811.0.m4s",
                profile: { duration: 0.5, independent: true },
                objectKey: "tenant/session/v1080/3811.0.m4s",
                partNumber: 0,
                slotId: "slot_3811_p0",
              },
              {
                commitId: "commit_3811_p1",
                deliveryUrl: "/media/3811.1.m4s",
                profile: { duration: 0.5 },
                objectKey: "tenant/session/v1080/3811.1.m4s",
                partNumber: 1,
                slotId: "slot_3811_p1",
              },
            ],
          },
        ],
      },
    },
  },
};

describe("cursor validation", () => {
  test("accepts a valid cursor", () => {
    expect(() => assertCursor(validCursor)).not.toThrow();
    expect(isCursor(validCursor)).toBe(true);
  });

  test("rejects a non-object cursor", () => {
    expect(() => assertCursor(null)).toThrow("cursor must be an object");
    expect(isCursor(null)).toBe(false);
  });

  test("rejects an unsupported wire version", () => {
    expect(() => assertCursor({ ...validCursor, olos: "2.0" })).toThrow(
      "cursor.olos must be 1.0"
    );
  });

  test("rejects unsafe identifiers", () => {
    expect(() =>
      assertCursor({ ...validCursor, sessionId: "../secret" })
    ).toThrow("cursor.sessionId must be a non-empty URL-safe identifier");
  });

  test("rejects invalid session state", () => {
    expect(() => assertCursor({ ...validCursor, state: "paused" })).toThrow(
      "cursor.state must be one of:"
    );
  });

  test("rejects cursor profiles without an id", () => {
    expect(() =>
      assertCursor({ ...validCursor, profile: { segmentTarget: 1 } })
    ).toThrow("cursor.profile.id must be a non-empty string");
  });

  test("rejects invalid timestamps", () => {
    expect(() =>
      assertCursor({ ...validCursor, updatedAt: "not-a-date" })
    ).toThrow("cursor.updatedAt must be a valid timestamp");
  });

  test("rejects unsafe deliveryBaseUrl", () => {
    expect(() =>
      assertCursor({ ...validCursor, deliveryBaseUrl: "javascript:alert(1)" })
    ).toThrow(
      "cursor.deliveryBaseUrl must be an absolute HTTP(S) URL or safe relative path"
    );
  });

  test("rejects non-monotonic cursor windows", () => {
    expect(() =>
      assertCursor({
        ...validCursor,
        window: {
          firstSequenceNumber: 3811,
          lastSequenceNumber: 3810,
        },
      })
    ).toThrow(
      "cursor.window.firstSequenceNumber must be less than or equal to lastSequenceNumber"
    );
  });

  test("rejects invalid cursor part numbers", () => {
    expect(() =>
      assertCursor({
        ...validCursor,
        window: {
          ...validCursor.window,
          lastPartNumber: -1,
        },
      })
    ).toThrow("cursor.window.lastPartNumber must be a non-negative integer");
  });

  test("accepts cursor part progress with matching media sequence bounds", () => {
    expect(() =>
      assertCursor({
        ...cursorWithVisibleParts,
        window: {
          ...cursorWithVisibleParts.window,
          lastPartNumber: 1,
        },
      })
    ).not.toThrow();
  });

  test("rejects cursor part progress the committed window does not show", () => {
    // §3.8: a present lastPartNumber must equal the window's last visible
    // part number — 1 in the parts fixture, absent in the full-segment one.
    expect(() =>
      assertCursor({
        ...cursorWithVisibleParts,
        window: {
          ...cursorWithVisibleParts.window,
          lastPartNumber: 5,
        },
      })
    ).toThrow(
      "cursor.window.lastPartNumber must equal the committed window's last visible part number"
    );
    expect(() =>
      assertCursor({
        ...validCursor,
        window: {
          ...validCursor.window,
          lastPartNumber: 1,
        },
      })
    ).toThrow(
      "cursor.window.lastPartNumber must equal the committed window's last visible part number"
    );
  });

  test("rejects cursor epoch mismatches", () => {
    expect(() => assertCursor({ ...validCursor, epoch: 5 })).toThrow(
      "cursor.epoch must match committedWindow.epoch"
    );
  });

  test("rejects cursor window mismatches", () => {
    expect(() =>
      assertCursor({
        ...validCursor,
        window: {
          firstSequenceNumber: 3810,
          lastSequenceNumber: 3810,
        },
      })
    ).toThrow("cursor.window must match committedWindow sequence bounds");
  });
});

describe("tolerant cursor parsing", () => {
  test("strips unknown fields and returns a fresh cursor", () => {
    const parsed = parseCursor({ ...validCursor, extra: 1 });

    expect(parsed).toEqual(validCursor);
    expect(parsed).not.toBe(validCursor);
  });

  test("strips unknown fields at every nesting level", () => {
    const track = cursorWithVisibleParts.committedWindow.tracks.v1080;
    const partsSegment = track?.segments[1];
    const firstPart = partsSegment?.parts?.[0];
    const secondPart = partsSegment?.parts?.[1];

    if (
      track === undefined ||
      partsSegment === undefined ||
      firstPart === undefined ||
      secondPart === undefined
    ) {
      throw new Error("missing parts fixture");
    }

    const parsed = parseCursor({
      ...cursorWithVisibleParts,
      committedWindow: {
        ...cursorWithVisibleParts.committedWindow,
        extra: 1,
        tracks: {
          v1080: {
            ...track,
            extra: 1,
            segments: [
              track.segments[0],
              {
                ...partsSegment,
                extra: 1,
                parts: [{ ...firstPart, extra: 1 }, secondPart],
              },
            ],
          },
        },
      },
      extra: 1,
      window: { ...cursorWithVisibleParts.window, extra: 1 },
    });

    expect(parsed).toEqual(cursorWithVisibleParts);
  });

  test("still rejects invalid known fields", () => {
    expect(() =>
      parseCursor({ ...validCursor, extra: 1, updatedAt: "not-a-date" })
    ).toThrow("cursor.updatedAt must be a valid timestamp");
  });
});
