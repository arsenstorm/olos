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
    expiresAt: options.expiresAt ?? options.slot.expiresAt,
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

  assertAdditionalUploadHeaders(options.additionalHeaders);
  assertNoReservedAdditionalHeaders(options.additionalHeaders, headers);

  return { ...headers, ...options.additionalHeaders };
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
  const reserved = new Set(
    Object.keys(reservedHeaders).map((header) => header.toLowerCase())
  );

  for (const header of Object.keys(additionalHeaders)) {
    if (reserved.has(header.toLowerCase())) {
      throw new Error(`additionalHeaders must not override ${header}`);
    }
  }
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
    options.expiresAt ?? options.slot.expiresAt,
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
