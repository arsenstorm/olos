import type {
  CoordinatorPipelineState,
  CoordinatorPublisherLease,
} from "../protocol";
import type { Cursor } from "../types/cursor";
import { assertCursor } from "../validation/cursor";
import {
  type RuntimePublisherLease,
  type RuntimePublisherLeaseStatus,
  resolveRuntimePublisherLeaseStatus,
} from "./publisher-lease";
import { positiveNumber, timestampMs } from "./request-fields";

export interface ResolveRuntimeLiveHealthOptions {
  cursor?: Cursor;
  lease?: RuntimePublisherLease;
  maxCursorAgeMs: number;
  now: string;
}

export interface ResolveRuntimeLiveHealthFromStateOptions {
  maxCursorAgeMs: number;
  now: string;
  publisherInstanceId?: string;
  state: CoordinatorPipelineState;
}

export type RuntimeCursorFreshness = "fresh" | "missing" | "stale";
export type RuntimeLiveHealthStatus = "active" | "stale" | "starting";

export interface RuntimeLiveHealth {
  cursorAgeMs?: number;
  cursorFreshness: RuntimeCursorFreshness;
  leaseStatus?: RuntimePublisherLeaseStatus;
  publisherInstanceId?: string;
  status: RuntimeLiveHealthStatus;
}

export function resolveRuntimeLiveHealth(
  options: ResolveRuntimeLiveHealthOptions
): RuntimeLiveHealth {
  const nowMs = timestampMs(options.now, "now");
  const maxCursorAgeMs = positiveNumber(
    options.maxCursorAgeMs,
    "maxCursorAgeMs"
  );
  const leaseStatus =
    options.lease === undefined
      ? undefined
      : resolveRuntimePublisherLeaseStatus({
          lease: options.lease,
          now: options.now,
        });

  if (options.cursor === undefined) {
    return missingCursorLiveHealth(leaseStatus);
  }

  assertCursor(options.cursor);

  return cursorLiveHealth(options.cursor, nowMs, maxCursorAgeMs, leaseStatus);
}

function missingCursorLiveHealth(
  leaseStatus: RuntimePublisherLeaseStatus | undefined
): RuntimeLiveHealth {
  return {
    cursorFreshness: "missing",
    ...leaseStatusField(leaseStatus),
    status: leaseStatus === "stale" ? "stale" : "starting",
  };
}

function cursorLiveHealth(
  cursor: Cursor,
  nowMs: number,
  maxCursorAgeMs: number,
  leaseStatus: RuntimePublisherLeaseStatus | undefined
): RuntimeLiveHealth {
  const cursorAgeMs = cursorAgeMsSince(cursor, nowMs);
  const cursorFreshness = cursorFreshnessForAge(cursorAgeMs, maxCursorAgeMs);

  return {
    cursorAgeMs,
    cursorFreshness,
    ...leaseStatusField(leaseStatus),
    status: liveHealthStatus(cursorFreshness, leaseStatus),
  };
}

function leaseStatusField(
  leaseStatus: RuntimePublisherLeaseStatus | undefined
): Pick<RuntimeLiveHealth, "leaseStatus"> | Record<string, never> {
  return leaseStatus === undefined ? {} : { leaseStatus };
}

function cursorAgeMsSince(cursor: Cursor, nowMs: number): number {
  const cursorAgeMs = nowMs - timestampMs(cursor.updatedAt, "cursor.updatedAt");

  if (cursorAgeMs < 0) {
    throw new Error("now must be after or equal to cursor.updatedAt");
  }

  return cursorAgeMs;
}

function cursorFreshnessForAge(
  cursorAgeMs: number,
  maxCursorAgeMs: number
): RuntimeCursorFreshness {
  return cursorAgeMs <= maxCursorAgeMs ? "fresh" : "stale";
}

function liveHealthStatus(
  cursorFreshness: RuntimeCursorFreshness,
  leaseStatus: RuntimePublisherLeaseStatus | undefined
): RuntimeLiveHealthStatus {
  return cursorFreshness === "fresh" && leaseStatus !== "stale"
    ? "active"
    : "stale";
}

export function resolveRuntimeLiveHealthFromState(
  options: ResolveRuntimeLiveHealthFromStateOptions
): RuntimeLiveHealth {
  const lease = selectPublisherLease(
    options.state.publisherLeases,
    options.publisherInstanceId
  );
  const health = resolveRuntimeLiveHealth({
    cursor: options.state.cursor,
    lease,
    maxCursorAgeMs: options.maxCursorAgeMs,
    now: options.now,
  });

  return {
    ...health,
    ...(options.publisherInstanceId !== undefined && lease === undefined
      ? { status: "stale" }
      : {}),
    ...(lease === undefined
      ? {}
      : { publisherInstanceId: lease.publisherInstanceId }),
  };
}

function selectPublisherLease(
  leases: readonly CoordinatorPublisherLease[],
  publisherInstanceId: string | undefined
): CoordinatorPublisherLease | undefined {
  if (publisherInstanceId !== undefined) {
    return selectRequestedPublisherLease(leases, publisherInstanceId);
  }

  return selectLatestPublisherLease(leases);
}

function selectRequestedPublisherLease(
  leases: readonly CoordinatorPublisherLease[],
  publisherInstanceId: string
): CoordinatorPublisherLease | undefined {
  return leases.find(
    (lease) => lease.publisherInstanceId === publisherInstanceId
  );
}

function selectLatestPublisherLease(
  leases: readonly CoordinatorPublisherLease[]
): CoordinatorPublisherLease | undefined {
  let latest: CoordinatorPublisherLease | undefined;

  for (const lease of leases) {
    if (isNewerPublisherLease(lease, latest)) {
      latest = lease;
    }
  }

  return latest;
}

function isNewerPublisherLease(
  lease: CoordinatorPublisherLease,
  current: CoordinatorPublisherLease | undefined
): boolean {
  return current === undefined || lease.lastSeenAt > current.lastSeenAt;
}
