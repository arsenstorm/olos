import { assertUrlSafeIdentifier } from "../validation/ids";
import { isRecord } from "./request-fields";

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

  const nowMs = timestampMs(options.now, "now");
  const ttlMs = positiveTtlMs(options.ttlMs);

  return {
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
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
  const ttlMs = positiveTtlMs(options.ttlMs);

  if (nowMs < timestampMs(options.lease.issuedAt, "publisherLease.issuedAt")) {
    throw new Error("now must be after or equal to publisherLease.issuedAt");
  }

  return {
    ...options.lease,
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
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

function assertLeaseOwner(
  lease: RuntimePublisherLease,
  owner: {
    publisherInstanceId: string;
    sessionId: string;
    tenantId: string;
  }
): void {
  assertRuntimePublisherLease(lease);

  for (const field of [
    "tenantId",
    "sessionId",
    "publisherInstanceId",
  ] as const) {
    if (lease[field] !== owner[field]) {
      throw new Error(`publisherLease.${field} does not match heartbeat`);
    }
  }
}

function assertLeaseIdentity(value: Record<string, unknown>): void {
  for (const field of [
    "tenantId",
    "sessionId",
    "publisherInstanceId",
  ] as const) {
    assertUrlSafeIdentifier(value[field], `publisherLease.${field}`);
  }
}

function timestampFieldMs(
  value: Record<string, unknown>,
  field: "expiresAt" | "issuedAt" | "lastSeenAt"
): number {
  if (typeof value[field] !== "string") {
    throw new Error(`publisherLease.${field} must be a valid timestamp`);
  }

  return timestampMs(value[field], `publisherLease.${field}`);
}

function positiveTtlMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("ttlMs must be a positive number");
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
