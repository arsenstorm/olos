import { assertUrlSafeIdentifier } from "../validation/ids";
import { isRecord, positiveNumber, timestampMs } from "./request-fields";

const LEASE_IDENTITY_FIELDS = [
  "tenantId",
  "sessionId",
  "publisherInstanceId",
] as const;

type LeaseTimestampField = "expiresAt" | "issuedAt" | "lastSeenAt";

export interface RuntimePublisherLease {
  expiresAt: string;
  issuedAt: string;
  lastSeenAt: string;
  publisherInstanceId: string;
  sessionId: string;
  tenantId: string;
}

export interface CreateRuntimePublisherLeaseOptions {
  now: string;
  publisherInstanceId: string;
  sessionId: string;
  tenantId: string;
  ttlMs: number;
}

export interface RefreshRuntimePublisherLeaseOptions {
  lease: RuntimePublisherLease;
  now: string;
  ttlMs: number;
}

export interface RefreshRuntimePublisherHeartbeatOptions
  extends RefreshRuntimePublisherLeaseOptions {
  publisherInstanceId: string;
  sessionId: string;
  tenantId: string;
}

export interface ResolveRuntimePublisherLeaseStatusOptions {
  lease: RuntimePublisherLease;
  now: string;
}

export type RuntimePublisherLeaseStatus = "active" | "stale";

export function createRuntimePublisherLease(
  options: CreateRuntimePublisherLeaseOptions
): RuntimePublisherLease {
  assertLeaseIdentity({
    publisherInstanceId: options.publisherInstanceId,
    sessionId: options.sessionId,
    tenantId: options.tenantId,
  });

  return {
    expiresAt: leaseExpiresAt(options.now, options.ttlMs),
    issuedAt: options.now,
    lastSeenAt: options.now,
    publisherInstanceId: options.publisherInstanceId,
    sessionId: options.sessionId,
    tenantId: options.tenantId,
  };
}

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

export function refreshRuntimePublisherHeartbeat(
  options: RefreshRuntimePublisherHeartbeatOptions
): RuntimePublisherLease {
  assertLeaseIdentity({
    publisherInstanceId: options.publisherInstanceId,
    sessionId: options.sessionId,
    tenantId: options.tenantId,
  });
  assertLeaseOwner(options.lease, {
    publisherInstanceId: options.publisherInstanceId,
    sessionId: options.sessionId,
    tenantId: options.tenantId,
  });

  return refreshRuntimePublisherLease(options);
}

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
  owner: {
    publisherInstanceId: string;
    sessionId: string;
    tenantId: string;
  }
): void {
  assertRuntimePublisherLease(lease);

  for (const field of LEASE_IDENTITY_FIELDS) {
    if (lease[field] !== owner[field]) {
      throw new Error(`publisherLease.${field} does not match heartbeat`);
    }
  }
}

function assertRefreshTimeNotBeforeIssuedAt(
  lease: RuntimePublisherLease,
  nowMs: number
): void {
  const issuedAtMs = timestampMs(lease.issuedAt, "publisherLease.issuedAt");

  if (nowMs < issuedAtMs) {
    throw new Error("now must be after or equal to publisherLease.issuedAt");
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
