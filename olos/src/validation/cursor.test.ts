import { describe, expect, test } from "bun:test";
import type { Cursor } from "../types/cursor";
import { assertCursor, isCursor } from "./cursor";

const validCursor: Cursor = {
  committedWindow: {
    discontinuitySequence: 0,
    epoch: 4,
    firstMediaSequenceNumber: 3810,
    lastMediaSequenceNumber: 3811,
    renditions: {
      v1080: {
        init: {
          commitId: "commit_init",
          deliveryUrl: "/media/init.mp4",
          objectKey: "tenant/session/v1080/init.mp4",
          slotId: "slot_init",
        },
        renditionId: "v1080",
        segments: [
          {
            duration: 1,
            mediaSequenceNumber: 3810,
            segment: {
              commitId: "commit_3810",
              deliveryUrl: "/media/3810.m4s",
              objectKey: "tenant/session/v1080/3810.m4s",
              slotId: "slot_3810",
            },
          },
          {
            duration: 1,
            mediaSequenceNumber: 3811,
            segment: {
              commitId: "commit_3811",
              deliveryUrl: "/media/3811.m4s",
              objectKey: "tenant/session/v1080/3811.m4s",
              slotId: "slot_3811",
            },
          },
        ],
      },
    },
  },
  epoch: 4,
  latencyProfile: "object-ll",
  mediaBaseUrl: "https://media.example.com",
  olos: "1.0",
  partTarget: 0.333,
  segmentTarget: 1,
  sessionId: "session_1",
  state: "live",
  tenantId: "tenant_1",
  updatedAt: "2026-06-08T12:00:01.820Z",
  window: {
    firstMediaSequenceNumber: 3810,
    lastMediaSequenceNumber: 3811,
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

  test("rejects invalid latency profile", () => {
    expect(() =>
      assertCursor({ ...validCursor, latencyProfile: "slow" })
    ).toThrow("cursor.latencyProfile must be one of:");
  });

  test("rejects invalid timestamps", () => {
    expect(() =>
      assertCursor({ ...validCursor, updatedAt: "not-a-date" })
    ).toThrow("cursor.updatedAt must be a valid timestamp");
  });

  test("rejects unsafe mediaBaseUrl", () => {
    expect(() =>
      assertCursor({ ...validCursor, mediaBaseUrl: "javascript:alert(1)" })
    ).toThrow(
      "cursor.mediaBaseUrl must be an absolute HTTP(S) URL or safe relative path"
    );
  });

  test("rejects non-monotonic cursor windows", () => {
    expect(() =>
      assertCursor({
        ...validCursor,
        window: {
          firstMediaSequenceNumber: 3811,
          lastMediaSequenceNumber: 3810,
        },
      })
    ).toThrow(
      "cursor.window.firstMediaSequenceNumber must be less than or equal to lastMediaSequenceNumber"
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
        ...validCursor,
        window: {
          ...validCursor.window,
          lastPartNumber: 1,
        },
      })
    ).not.toThrow();
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
          firstMediaSequenceNumber: 3810,
          lastMediaSequenceNumber: 3810,
        },
      })
    ).toThrow("cursor.window must match committedWindow media sequence");
  });
});
