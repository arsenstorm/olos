import { isRecord, positiveNumber } from "../validation/fields";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { timestampMs } from "./request-fields";

const LEASE_IDENTITY_FIELDS = ["sessionId", "publisherInstanceId"] as const;

type LeaseTimestampField = "expiresAt" | "issuedAt" | "lastSeenAt";
type LeaseIdentity = Pick<
  RuntimePublisherLease,
  "publisherInstanceId" | "sessionId"
>;

/**
 * A publisher's liveness lease on a session, kept alive by heartbeats.
 * Timestamps are ISO 8601 strings and must satisfy
 * `issuedAt <= lastSeenAt <= expiresAt`.
 */
export interface RuntimePublisherLease {
  expiresAt: string;
  issuedAt: string;
  /** Time of the most recent heartbeat. */
  lastSeenAt: string;
  publisherInstanceId: string;
  sessionId: string;
}

/** Options for `createRuntimePublisherLease`. */
export interface CreateRuntimePublisherLeaseOptions {
  /** Issue time as an ISO 8601 timestamp. */
  now: string;
  publisherInstanceId: string;
  sessionId: string;
  /** Lease lifetime from `now`, in milliseconds. */
  ttlMs: number;
}

/** Options for `refreshRuntimePublisherLease`. */
export interface RefreshRuntimePublisherLeaseOptions {
  lease: RuntimePublisherLease;
  /** Refresh time; must not precede the lease's `issuedAt`. */
  now: string;
  /** New lifetime from `now`, in milliseconds. */
  ttlMs: number;
}

/**
 * Options for `refreshRuntimePublisherHeartbeat`: the refresh inputs plus
 * the identity claimed by the heartbeat, which must match the lease.
 */
export interface RefreshRuntimePublisherHeartbeatOptions
  extends RefreshRuntimePublisherLeaseOptions {
  publisherInstanceId: string;
  sessionId: string;
}

/** Options for `resolveRuntimePublisherLeaseStatus`. */
export interface ResolveRuntimePublisherLeaseStatusOptions {
  lease: RuntimePublisherLease;
  /** Evaluation time as an ISO 8601 timestamp. */
  now: string;
}

/** Lease verdict: `active` until `expiresAt` passes, `stale` after. */
export type RuntimePublisherLeaseStatus = "active" | "stale";

/**
 * Thrown when a lease refresh's `now` precedes the lease's `issuedAt`.
 * Typed so callers can map a heartbeat clocked before its lease to a
 * protocol rejection instead of an opaque internal error.
 */
export class RuntimePublisherLeaseClockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimePublisherLeaseClockError";
  }
}

/**
 * Create a new publisher lease issued at `now` and expiring `ttlMs`
 * milliseconds later. Throws when the identifiers are not URL-safe.
 */
export function createRuntimePublisherLease(
  options: CreateRuntimePublisherLeaseOptions
): RuntimePublisherLease {
  assertLeaseIdentity({
    publisherInstanceId: options.publisherInstanceId,
    sessionId: options.sessionId,
  });

  return {
    expiresAt: leaseExpiresAt(options.now, options.ttlMs),
    issuedAt: options.now,
    lastSeenAt: options.now,
    publisherInstanceId: options.publisherInstanceId,
    sessionId: options.sessionId,
  };
}

/**
 * Return a copy of the lease with `lastSeenAt` set to `now` and `expiresAt`
 * pushed out by `ttlMs` milliseconds. `issuedAt` is preserved. Throws when
 * the lease is malformed or `now` precedes its `issuedAt`.
 */
export function refreshRuntimePublisherLease(
  options: RefreshRuntimePublisherLeaseOptions
): RuntimePublisherLease {
  assertRuntimePublisherLease(options.lease);

  const nowMs = timestampMs(options.now, "now");
  assertRefreshTimeNotBeforeIssuedAt(options.lease, nowMs);

  return {
    ...options.lease,
    expiresAt: leaseExpiresAt(options.now, options.ttlMs),
    lastSeenAt: options.now,
  };
}

/**
 * Refresh a lease on behalf of a heartbeat, first verifying that the
 * heartbeat's `sessionId` and `publisherInstanceId` match the lease owner.
 * Throws on a mismatch, so one publisher cannot extend another's lease.
 */
export function refreshRuntimePublisherHeartbeat(
  options: RefreshRuntimePublisherHeartbeatOptions
): RuntimePublisherLease {
  const owner = heartbeatLeaseOwner(options);

  assertLeaseIdentity(owner);
  assertLeaseOwner(options.lease, owner);

  return refreshRuntimePublisherLease(options);
}

/**
 * Judge a lease at `now`: `active` while `now` is at or before the lease's
 * `expiresAt`, `stale` afterwards.
 */
export function resolveRuntimePublisherLeaseStatus(
  options: ResolveRuntimePublisherLeaseStatusOptions
): RuntimePublisherLeaseStatus {
  assertRuntimePublisherLease(options.lease);

  const nowMs = timestampMs(options.now, "now");
  const expiresAtMs = timestampMs(
    options.lease.expiresAt,
    "publisherLease.expiresAt"
  );

  return nowMs <= expiresAtMs ? "active" : "stale";
}

/**
 * Assert that a value is a well-formed `RuntimePublisherLease`: URL-safe
 * identifiers and a timeline satisfying
 * `issuedAt <= lastSeenAt <= expiresAt`. Throws with a descriptive message
 * otherwise.
 */
export function assertRuntimePublisherLease(
  value: unknown
): asserts value is RuntimePublisherLease {
  if (!isRecord(value)) {
    throw new Error("publisherLease must be an object");
  }

  assertLeaseIdentity(value);
  assertLeaseTimeline(value);
}

function assertLeaseTimeline(value: Record<string, unknown>): void {
  const issuedAtMs = timestampFieldMs(value, "issuedAt");
  const lastSeenAtMs = timestampFieldMs(value, "lastSeenAt");
  const expiresAtMs = timestampFieldMs(value, "expiresAt");

  if (lastSeenAtMs < issuedAtMs) {
    throw new Error("publisherLease.lastSeenAt must not be before issuedAt");
  }

  if (expiresAtMs < lastSeenAtMs) {
    throw new Error("publisherLease.expiresAt must not be before lastSeenAt");
  }
}

function leaseExpiresAt(now: string, ttlMsValue: number): string {
  const nowMs = timestampMs(now, "now");
  const ttlMs = positiveNumber(ttlMsValue, "ttlMs");

  return new Date(nowMs + ttlMs).toISOString();
}

function assertLeaseOwner(
  lease: RuntimePublisherLease,
  owner: LeaseIdentity
): void {
  assertRuntimePublisherLease(lease);

  for (const field of LEASE_IDENTITY_FIELDS) {
    assertLeaseOwnerField(lease, owner, field);
  }
}

function assertLeaseOwnerField(
  lease: RuntimePublisherLease,
  owner: LeaseIdentity,
  field: (typeof LEASE_IDENTITY_FIELDS)[number]
): void {
  if (lease[field] !== owner[field]) {
    throw new Error(`publisherLease.${field} does not match heartbeat`);
  }
}

function heartbeatLeaseOwner(
  options: RefreshRuntimePublisherHeartbeatOptions
): LeaseIdentity {
  return {
    publisherInstanceId: options.publisherInstanceId,
    sessionId: options.sessionId,
  };
}

function assertRefreshTimeNotBeforeIssuedAt(
  lease: RuntimePublisherLease,
  nowMs: number
): void {
  const issuedAtMs = timestampMs(lease.issuedAt, "publisherLease.issuedAt");

  if (nowMs < issuedAtMs) {
    throw new RuntimePublisherLeaseClockError(
      "now must be after or equal to publisherLease.issuedAt"
    );
  }
}

function assertLeaseIdentity(value: Record<string, unknown>): void {
  for (const field of LEASE_IDENTITY_FIELDS) {
    assertUrlSafeIdentifier(value[field], `publisherLease.${field}`);
  }
}

function timestampFieldMs(
  value: Record<string, unknown>,
  field: LeaseTimestampField
): number {
  if (typeof value[field] !== "string") {
    throw new Error(`publisherLease.${field} must be a valid timestamp`);
  }

  return timestampMs(value[field], `publisherLease.${field}`);
}
