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
    return {
      cursorFreshness: "missing",
      ...(leaseStatus === undefined ? {} : { leaseStatus }),
      status: leaseStatus === "stale" ? "stale" : "starting",
    };
  }

  assertCursor(options.cursor);

  const cursorAgeMs =
    nowMs - timestampMs(options.cursor.updatedAt, "cursor.updatedAt");

  if (cursorAgeMs < 0) {
    throw new Error("now must be after or equal to cursor.updatedAt");
  }

  const cursorFreshness = cursorAgeMs <= maxCursorAgeMs ? "fresh" : "stale";

  return {
    cursorAgeMs,
    cursorFreshness,
    ...(leaseStatus === undefined ? {} : { leaseStatus }),
    status:
      cursorFreshness === "fresh" && leaseStatus !== "stale"
        ? "active"
        : "stale",
  };
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
    return leases.find(
      (lease) => lease.publisherInstanceId === publisherInstanceId
    );
  }

  let latest: CoordinatorPublisherLease | undefined;

  for (const lease of leases) {
    if (latest === undefined || lease.lastSeenAt > latest.lastSeenAt) {
      latest = lease;
    }
  }

  return latest;
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return value;
}

function timestampMs(value: string, name: string): number {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    throw new Error(`${name} must be a valid timestamp`);
  }

  return timestamp;
}
