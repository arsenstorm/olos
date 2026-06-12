import { describe, expect, test } from "bun:test";
import {
  assertRuntimePublisherLease,
  createRuntimePublisherLease,
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
        tenantId: "tenant_1",
        ttlMs: 3000,
      })
    ).toEqual({
      expiresAt: "2026-01-01T00:00:03.000Z",
      issuedAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: "session_1",
      tenantId: "tenant_1",
    });
  });

  test("refreshes a publisher lease", () => {
    const lease = createRuntimePublisherLease({
      now: "2026-01-01T00:00:00.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: "session_1",
      tenantId: "tenant_1",
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

  test("detects stale publisher leases", () => {
    const lease = createRuntimePublisherLease({
      now: "2026-01-01T00:00:00.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: "session_1",
      tenantId: "tenant_1",
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
        tenantId: "tenant_1",
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
          tenantId: "tenant_1",
        },
        now: "2026-01-01T00:00:02.000Z",
        ttlMs: 3000,
      })
    ).toThrow("publisherLease.lastSeenAt must not be before issuedAt");
    expect(() => assertRuntimePublisherLease(null)).toThrow(
      "publisherLease must be an object"
    );
  });
});
