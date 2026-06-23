import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import { assertHttpHeaderStringMap } from "../validation/http-header";
import { assertUploadGrant } from "../validation/upload-grant";
import { assertUploadSlot } from "../validation/upload-slot";
import { timestampMs } from "./timestamp";

export interface CreateUploadGrantOptions {
  additionalHeaders?: Record<string, string>;
  expiresAt?: string;
  slot: UploadSlot;
  url: string;
}

export function createUploadGrant(
  options: CreateUploadGrantOptions
): UploadGrant {
  assertUploadSlot(options.slot);
  assertUploadGrantPreconditions(options);

  const grant: UploadGrant = {
    expiresAt: resolveUploadGrantExpiresAt(options),
    method: "PUT",
    requiredHeaders: createRequiredHeaders(options),
    slotId: options.slot.slotId,
    url: options.url,
  };

  assertUploadGrant(grant);
  return grant;
}

function createRequiredHeaders(
  options: CreateUploadGrantOptions
): Record<string, string> {
  const headers = createBaseRequiredHeaders(options.slot);

  if (options.additionalHeaders === undefined) {
    return headers;
  }

  return mergeAdditionalRequiredHeaders(headers, options.additionalHeaders);
}

function mergeAdditionalRequiredHeaders(
  baseHeaders: Record<string, string>,
  additionalHeaders: Record<string, string>
): Record<string, string> {
  assertAdditionalUploadHeaders(additionalHeaders);
  assertNoReservedAdditionalHeaders(additionalHeaders, baseHeaders);

  return { ...baseHeaders, ...additionalHeaders };
}

function createBaseRequiredHeaders(slot: UploadSlot): Record<string, string> {
  return {
    "Content-Type": slot.contentType,
    "If-None-Match": "*",
    "x-olos-slot-id": slot.slotId,
  };
}

function assertNoReservedAdditionalHeaders(
  additionalHeaders: Record<string, string>,
  reservedHeaders: Record<string, string>
): void {
  const reserved = reservedHeaderNames(reservedHeaders);

  for (const header of Object.keys(additionalHeaders)) {
    if (reserved.has(header.toLowerCase())) {
      throw new Error(`additionalHeaders must not override ${header}`);
    }
  }
}

function reservedHeaderNames(headers: Record<string, string>): Set<string> {
  return new Set(Object.keys(headers).map((header) => header.toLowerCase()));
}

export function assertAdditionalUploadHeaders(
  value: unknown
): asserts value is Record<string, string> {
  assertHttpHeaderStringMap(value, "additionalHeaders");
}

function assertUploadGrantPreconditions(
  options: CreateUploadGrantOptions
): void {
  if (options.slot.state !== "issued") {
    throw new Error("uploadSlot.state must be issued");
  }

  const grantExpiresAt = timestampMs(
    resolveUploadGrantExpiresAt(options),
    "uploadGrant.expiresAt"
  );
  const slotExpiresAt = timestampMs(
    options.slot.expiresAt,
    "uploadSlot.expiresAt"
  );

  if (grantExpiresAt > slotExpiresAt) {
    throw new Error(
      "uploadGrant.expiresAt must be before or equal to uploadSlot.expiresAt"
    );
  }
}

function resolveUploadGrantExpiresAt(
  options: CreateUploadGrantOptions
): string {
  return options.expiresAt ?? options.slot.expiresAt;
}
