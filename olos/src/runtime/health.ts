import type {
  CoordinatorPipelineState,
  CoordinatorPublisherLease,
} from "../protocol/coordinator-types";
import type { Cursor } from "../types/cursor";
import { assertCursor } from "../validation/cursor";
import { positiveNumber } from "../validation/fields";
import {
  type RuntimePublisherLease,
  type RuntimePublisherLeaseStatus,
  resolveRuntimePublisherLeaseStatus,
} from "./publisher-lease";
import { timestampMs } from "./request-fields";

/** Options for `resolveRuntimeLiveHealth`. */
export interface ResolveRuntimeLiveHealthOptions {
  /** Latest session cursor; omit when no commit has landed yet. */
  cursor?: Cursor;
  /** Publisher lease to fold into the verdict; omit to judge cursor only. */
  lease?: RuntimePublisherLease;
  /** Cursor age at which the session stops counting as fresh, in ms. */
  maxCursorAgeMs: number;
  /** Evaluation time as an ISO 8601 timestamp; must not precede the cursor. */
  now: string;
}

/** Options for `resolveRuntimeLiveHealthFromState`. */
export interface ResolveRuntimeLiveHealthFromStateOptions {
  /** Cursor age at which the session stops counting as fresh, in ms. */
  maxCursorAgeMs: number;
  /** Evaluation time as an ISO 8601 timestamp. */
  now: string;
  /**
   * Judge this specific publisher's lease. When omitted, the most recently
   * seen lease is used; when set but no matching lease exists, the health
   * status is forced to `stale`.
   */
  publisherInstanceId?: string;
  state: CoordinatorPipelineState;
}

/**
 * How current the session cursor is: `fresh` (within `maxCursorAgeMs`),
 * `stale` (older), or `missing` (no commit yet).
 */
export type RuntimeCursorFreshness = "fresh" | "missing" | "stale";

/**
 * Overall live health verdict: `active` (fresh cursor, lease not stale),
 * `starting` (no cursor yet, lease not stale), or `stale` otherwise.
 */
export type RuntimeLiveHealthStatus = "active" | "stale" | "starting";

/** Live health report for a session, as served by the health route. */
export interface RuntimeLiveHealth {
  /** Age of the cursor at evaluation time, in ms; absent when missing. */
  cursorAgeMs?: number;
  cursorFreshness: RuntimeCursorFreshness;
  /** Verdict on the evaluated publisher lease; absent when none exists. */
  leaseStatus?: RuntimePublisherLeaseStatus;
  /** Publisher whose lease was evaluated, when one matched. */
  publisherInstanceId?: string;
  status: RuntimeLiveHealthStatus;
}

/**
 * Judge a session's live health from its cursor and an optional publisher
 * lease. The status is `active` only when the cursor is no older than
 * `maxCursorAgeMs` and the lease (if given) has not expired; a session with
 * no cursor is `starting` rather than `stale` unless its lease already
 * expired. Throws when `now` precedes the cursor's `updatedAt`.
 */
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

/**
 * Judge a session's live health straight from coordinator pipeline state.
 * Selects the lease for `publisherInstanceId` when given (forcing the
 * status to `stale` if no such lease exists), otherwise the most recently
 * seen lease, then delegates to `resolveRuntimeLiveHealth`.
 */
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

  return stateLiveHealth({
    health,
    lease,
    publisherInstanceId: options.publisherInstanceId,
  });
}

function stateLiveHealth(options: {
  health: RuntimeLiveHealth;
  lease: CoordinatorPublisherLease | undefined;
  publisherInstanceId: string | undefined;
}): RuntimeLiveHealth {
  if (
    options.publisherInstanceId !== undefined &&
    options.lease === undefined
  ) {
    return {
      ...options.health,
      status: "stale",
    };
  }

  if (
    options.publisherInstanceId === undefined ||
    options.lease === undefined
  ) {
    return options.health;
  }

  return {
    ...options.health,
    publisherInstanceId: options.lease.publisherInstanceId,
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
