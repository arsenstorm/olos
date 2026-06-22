import { describe, expect, test } from "bun:test";
import {
  createEmptyCoordinatorState,
  testCoordinatorPathways as pathways,
} from "../protocol/coordinator-state.test-helper";
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
      publisherInstanceId: "publisher_2",
      status: "active",
    });
  });

  test("resolves health for a requested stored publisher lease", () => {
    expect(
      resolveRuntimeLiveHealthFromState({
        maxCursorAgeMs: 3000,
        now: "2026-01-01T00:00:05.001Z",
        publisherInstanceId: "publisher_1",
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
      publisherInstanceId: "publisher_1",
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

    expect(() =>
      resolveRuntimeLiveHealth({
        cursor: cursor(),
        maxCursorAgeMs: 3000,
        now: "2025-12-31T23:59:59.999Z",
      })
    ).toThrow("now must be after or equal to cursor.updatedAt");
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
    tenantId: "tenant_1",
  };
}

function cursor(updatedAt = "2026-01-01T00:00:00.000Z"): Cursor {
  return {
    committedWindow: {
      discontinuitySequence: 0,
      epoch: 1,
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
      renditions: {
        v1080: {
          init: {
            commitId: "commit_init",
            deliveryUrl: "https://media.example.com/init.mp4",
            objectKey: "media/init.mp4",
            slotId: "slot_init",
          },
          renditionId: "v1080",
          segments: [
            {
              duration: 2,
              independent: true,
              mediaSequenceNumber: 3810,
              segment: {
                commitId: "commit_3810",
                deliveryUrl: "https://media.example.com/s3810.m4s",
                objectKey: "media/s3810.m4s",
                slotId: "slot_3810",
              },
            },
          ],
        },
      },
    },
    epoch: 1,
    latencyProfile: "object-ll",
    olos: "1.0",
    partTarget: 0.5,
    pathways,
    segmentTarget: 2,
    sessionId: "session_1",
    state: "live",
    tenantId: "tenant_1",
    updatedAt,
    window: {
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    },
  };
}
