import { describe, expect, test } from "bun:test";
import {
  assertRuntimePublisherLease,
  createRuntimePublisherLease,
  refreshRuntimePublisherHeartbeat,
  refreshRuntimePublisherLease,
  resolveRuntimePublisherLeaseStatus,
} from "./publisher-lease";

describe("runtime publisher lease", () => {
  test("creates a publisher lease with an expiry", () => {
    expect(
      createRuntimePublisherLease({
        now: "2026-01-01T00:00:00.000Z",
        publisherInstanceId: "publisher_1",
        sessionId: "session_1",
        ttlMs: 3000,
      })
    ).toEqual({
      expiresAt: "2026-01-01T00:00:03.000Z",
      issuedAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: "session_1",
    });
  });

  test("refreshes a publisher lease", () => {
    const lease = createRuntimePublisherLease({
      now: "2026-01-01T00:00:00.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: "session_1",
      ttlMs: 3000,
    });

    expect(
      refreshRuntimePublisherLease({
        lease,
        now: "2026-01-01T00:00:02.000Z",
        ttlMs: 3000,
      })
    ).toEqual({
      ...lease,
      expiresAt: "2026-01-01T00:00:05.000Z",
      lastSeenAt: "2026-01-01T00:00:02.000Z",
    });
  });

  test("rejects refreshing a publisher lease before it was issued", () => {
    const lease = createRuntimePublisherLease({
      now: "2026-01-01T00:00:01.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: "session_1",
      ttlMs: 3000,
    });

    expect(() =>
      refreshRuntimePublisherLease({
        lease,
        now: "2026-01-01T00:00:00.999Z",
        ttlMs: 3000,
      })
    ).toThrow("now must be after or equal to publisherLease.issuedAt");
  });

  test("refreshes a matching publisher heartbeat", () => {
    const lease = createRuntimePublisherLease({
      now: "2026-01-01T00:00:00.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: "session_1",
      ttlMs: 3000,
    });

    expect(
      refreshRuntimePublisherHeartbeat({
        lease,
        now: "2026-01-01T00:00:02.000Z",
        publisherInstanceId: "publisher_1",
        sessionId: "session_1",
        ttlMs: 3000,
      })
    ).toEqual({
      ...lease,
      expiresAt: "2026-01-01T00:00:05.000Z",
      lastSeenAt: "2026-01-01T00:00:02.000Z",
    });
  });

  test("rejects a heartbeat for a different publisher", () => {
    const lease = createRuntimePublisherLease({
      now: "2026-01-01T00:00:00.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: "session_1",
      ttlMs: 3000,
    });

    expect(() =>
      refreshRuntimePublisherHeartbeat({
        lease,
        now: "2026-01-01T00:00:02.000Z",
        publisherInstanceId: "publisher_2",
        sessionId: "session_1",
        ttlMs: 3000,
      })
    ).toThrow("publisherLease.publisherInstanceId does not match heartbeat");
  });

  test("rejects a heartbeat for a different session", () => {
    const lease = createRuntimePublisherLease({
      now: "2026-01-01T00:00:00.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: "session_1",
      ttlMs: 3000,
    });

    expect(() =>
      refreshRuntimePublisherHeartbeat({
        lease,
        now: "2026-01-01T00:00:02.000Z",
        publisherInstanceId: "publisher_1",
        sessionId: "session_2",
        ttlMs: 3000,
      })
    ).toThrow("publisherLease.sessionId does not match heartbeat");
  });

  test("detects stale publisher leases", () => {
    const lease = createRuntimePublisherLease({
      now: "2026-01-01T00:00:00.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: "session_1",
      ttlMs: 3000,
    });

    expect(
      resolveRuntimePublisherLeaseStatus({
        lease,
        now: "2026-01-01T00:00:03.000Z",
      })
    ).toBe("active");
    expect(
      resolveRuntimePublisherLeaseStatus({
        lease,
        now: "2026-01-01T00:00:03.001Z",
      })
    ).toBe("stale");
  });

  test("rejects invalid publisher leases", () => {
    expect(() =>
      createRuntimePublisherLease({
        now: "2026-01-01T00:00:00.000Z",
        publisherInstanceId: "publisher 1",
        sessionId: "session_1",
        ttlMs: 3000,
      })
    ).toThrow(
      "publisherLease.publisherInstanceId must be a non-empty URL-safe identifier"
    );
    expect(() =>
      refreshRuntimePublisherLease({
        lease: {
          expiresAt: "2026-01-01T00:00:03.000Z",
          issuedAt: "2026-01-01T00:00:02.000Z",
          lastSeenAt: "2026-01-01T00:00:01.000Z",
          publisherInstanceId: "publisher_1",
          sessionId: "session_1",
        },
        now: "2026-01-01T00:00:02.000Z",
        ttlMs: 3000,
      })
    ).toThrow("publisherLease.lastSeenAt must not be before issuedAt");
    expect(() =>
      refreshRuntimePublisherLease({
        lease: {
          expiresAt: "2026-01-01T00:00:01.000Z",
          issuedAt: "2026-01-01T00:00:00.000Z",
          lastSeenAt: "2026-01-01T00:00:02.000Z",
          publisherInstanceId: "publisher_1",
          sessionId: "session_1",
        },
        now: "2026-01-01T00:00:02.000Z",
        ttlMs: 3000,
      })
    ).toThrow("publisherLease.expiresAt must not be before lastSeenAt");
    expect(() => assertRuntimePublisherLease(null)).toThrow(
      "publisherLease must be an object"
    );
  });

  test("rejects publisher leases with invalid timestamp fields", () => {
    expect(() =>
      assertRuntimePublisherLease({
        expiresAt: 0,
        issuedAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
        publisherInstanceId: "publisher_1",
        sessionId: "session_1",
      })
    ).toThrow("publisherLease.expiresAt must be a valid timestamp");
  });
});
