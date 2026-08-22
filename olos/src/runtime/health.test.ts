import { describe, expect, test } from "bun:test";
import { createEmptyCoordinatorState } from "../protocol/coordinator-state.test-helper";
import type { Cursor } from "../types/cursor";
import {
  resolveRuntimeLiveHealth,
  resolveRuntimeLiveHealthFromState,
} from "./health";
import type { RuntimePublisherLease } from "./publisher-lease";

describe("runtime live health", () => {
  test("resolves active health from a fresh cursor and lease", () => {
    expect(
      resolveRuntimeLiveHealth({
        cursor: cursor(),
        lease: lease(),
        maxCursorAgeMs: 3000,
        now: "2026-01-01T00:00:02.000Z",
      })
    ).toEqual({
      cursorAgeMs: 2000,
      cursorFreshness: "fresh",
      leaseStatus: "active",
      status: "active",
    });
  });

  test("resolves starting health before a cursor exists", () => {
    expect(
      resolveRuntimeLiveHealth({
        lease: lease(),
        maxCursorAgeMs: 3000,
        now: "2026-01-01T00:00:01.000Z",
      })
    ).toEqual({
      cursorFreshness: "missing",
      leaseStatus: "active",
      status: "starting",
    });
  });

  test("resolves starting health before a cursor or lease exists", () => {
    expect(
      resolveRuntimeLiveHealth({
        maxCursorAgeMs: 3000,
        now: "2026-01-01T00:00:01.000Z",
      })
    ).toEqual({
      cursorFreshness: "missing",
      status: "starting",
    });
  });

  test("marks stale cursor progress as stale", () => {
    expect(
      resolveRuntimeLiveHealth({
        cursor: cursor(),
        maxCursorAgeMs: 3000,
        now: "2026-01-01T00:00:03.001Z",
      })
    ).toEqual({
      cursorAgeMs: 3001,
      cursorFreshness: "stale",
      status: "stale",
    });
  });

  test("treats cursor age at the configured maximum as fresh", () => {
    expect(
      resolveRuntimeLiveHealth({
        cursor: cursor(),
        maxCursorAgeMs: 3000,
        now: "2026-01-01T00:00:03.000Z",
      })
    ).toEqual({
      cursorAgeMs: 3000,
      cursorFreshness: "fresh",
      status: "active",
    });
  });

  test("marks stale publisher leases as stale", () => {
    expect(
      resolveRuntimeLiveHealth({
        cursor: cursor("2026-01-01T00:00:05.000Z"),
        lease: lease(),
        maxCursorAgeMs: 3000,
        now: "2026-01-01T00:00:05.001Z",
      })
    ).toMatchObject({
      cursorAgeMs: 1,
      cursorFreshness: "fresh",
      leaseStatus: "stale",
      status: "stale",
    });
  });

  test("resolves health from the latest stored publisher lease", () => {
    expect(
      resolveRuntimeLiveHealthFromState({
        maxCursorAgeMs: 3000,
        now: "2026-01-01T00:00:02.000Z",
        state: {
          ...createEmptyCoordinatorState(),
          cursor: cursor(),
          publisherLeases: [
            lease("publisher_1", "2026-01-01T00:00:00.000Z"),
            lease("publisher_2", "2026-01-01T00:00:01.000Z"),
          ],
        },
      })
    ).toEqual({
      cursorAgeMs: 2000,
      cursorFreshness: "fresh",
      leaseStatus: "active",
      status: "active",
    });
  });

  test("orders stored publisher leases by instant, not by timestamp string", () => {
    // "T01:00:30+01:00" sorts lexicographically after "T00:00:45Z" but is
    // the earlier instant (00:00:30Z); the UTC lease must win, and its
    // unexpired lease keeps the session active.
    expect(
      resolveRuntimeLiveHealthFromState({
        maxCursorAgeMs: 3000,
        now: "2026-01-01T00:00:50.000Z",
        state: {
          ...createEmptyCoordinatorState(),
          cursor: cursor("2026-01-01T00:00:48.000Z"),
          publisherLeases: [
            {
              expiresAt: "2026-01-01T00:00:33.000Z",
              issuedAt: "2026-01-01T00:00:00.000Z",
              lastSeenAt: "2026-01-01T01:00:30.000+01:00",
              publisherInstanceId: "publisher_offset",
              sessionId: "session_1",
            },
            {
              expiresAt: "2026-01-01T00:00:55.000Z",
              issuedAt: "2026-01-01T00:00:00.000Z",
              lastSeenAt: "2026-01-01T00:00:45.000Z",
              publisherInstanceId: "publisher_utc",
              sessionId: "session_1",
            },
          ],
        },
      })
    ).toEqual({
      cursorAgeMs: 2000,
      cursorFreshness: "fresh",
      leaseStatus: "active",
      status: "active",
    });
  });

  test("resolves state health without stored publisher leases", () => {
    expect(
      resolveRuntimeLiveHealthFromState({
        maxCursorAgeMs: 3000,
        now: "2026-01-01T00:00:02.000Z",
        state: {
          ...createEmptyCoordinatorState(),
          cursor: cursor(),
          publisherLeases: [],
        },
      })
    ).toEqual({
      cursorAgeMs: 2000,
      cursorFreshness: "fresh",
      status: "active",
    });
  });

  test("resolves health for a requested stored publisher lease", () => {
    expect(
      resolveRuntimeLiveHealthFromState({
        maxCursorAgeMs: 3000,
        now: "2026-01-01T00:00:05.001Z",
        state: {
          ...createEmptyCoordinatorState(),
          cursor: cursor("2026-01-01T00:00:05.000Z"),
          publisherLeases: [
            lease("publisher_1", "2026-01-01T00:00:00.000Z"),
            lease("publisher_2", "2026-01-01T00:00:05.000Z"),
          ],
        },
      })
    ).toMatchObject({
      cursorFreshness: "fresh",
      leaseStatus: "stale",
      status: "stale",
    });
  });

  test("marks a missing requested publisher lease as stale", () => {
    expect(
      resolveRuntimeLiveHealthFromState({
        maxCursorAgeMs: 3000,
        now: "2026-01-01T00:00:02.000Z",
        publisherInstanceId: "publisher_missing",
        state: {
          ...createEmptyCoordinatorState(),
          cursor: cursor(),
          publisherLeases: [lease()],
        },
      })
    ).toEqual({
      cursorAgeMs: 2000,
      cursorFreshness: "fresh",
      status: "stale",
    });
  });

  test("marks a missing requested publisher lease as stale before a cursor exists", () => {
    expect(
      resolveRuntimeLiveHealthFromState({
        maxCursorAgeMs: 3000,
        now: "2026-01-01T00:00:02.000Z",
        publisherInstanceId: "publisher_missing",
        state: {
          ...createEmptyCoordinatorState(),
          publisherLeases: [lease()],
        },
      })
    ).toEqual({
      cursorFreshness: "missing",
      status: "stale",
    });
  });

  test("rejects invalid health inputs", () => {
    expect(() =>
      resolveRuntimeLiveHealth({
        cursor: cursor(),
        maxCursorAgeMs: 0,
        now: "2026-01-01T00:00:02.000Z",
      })
    ).toThrow("maxCursorAgeMs must be a positive number");

    expect(() =>
      resolveRuntimeLiveHealth({
        cursor: cursor(),
        maxCursorAgeMs: 3000,
        now: "not-a-date",
      })
    ).toThrow("now must be a valid timestamp");
  });

  test("clamps cursor age to fresh when the cursor is ahead of now", () => {
    // A publisher's committedAt can run ahead of this server's clock;
    // forward skew must read as a fresh cursor, not a failure.
    expect(
      resolveRuntimeLiveHealth({
        cursor: cursor(),
        maxCursorAgeMs: 3000,
        now: "2025-12-31T23:59:59.999Z",
      })
    ).toEqual({
      cursorAgeMs: 0,
      cursorFreshness: "fresh",
      status: "active",
    });
  });
});

function lease(
  publisherInstanceId = "publisher_1",
  lastSeenAt = "2026-01-01T00:00:00.000Z"
): RuntimePublisherLease {
  return {
    expiresAt: "2026-01-01T00:00:05.000Z",
    issuedAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt,
    publisherInstanceId,
    sessionId: "session_1",
  };
}

function cursor(updatedAt = "2026-01-01T00:00:00.000Z"): Cursor {
  return {
    committedWindow: {
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
                deliveryUrl: "https://media.example.com/media/v1080/s3810.m4s",
                objectKey: "media/v1080/s3810.m4s",
                profile: { duration: 2, independent: true },
                slotId: "slot_3810",
              },
            },
          ],
        },
      },
    },
    epoch: 1,
    olos: "1.0",
    deliveryBaseUrl: "https://media.example.com",
    profile: { id: "cmaf-llhls", partTarget: 0.5, segmentTarget: 2 },
    sessionId: "session_1",
    state: "live",
    updatedAt,
    window: {
      firstSequenceNumber: 3810,
      lastSequenceNumber: 3810,
    },
  };
}
