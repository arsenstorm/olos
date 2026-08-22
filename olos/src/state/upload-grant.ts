import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import { timestampMs } from "../validation/fields";
import { assertHttpHeaderStringMap } from "../validation/http-header";
import { assertUploadGrant } from "../validation/upload-grant";
import { assertUploadSlot } from "../validation/upload-slot";

/** Options for {@link createUploadGrant}. */
export interface CreateUploadGrantOptions {
  /**
   * Extra headers the publisher must send with the upload. Merged into
   * the base required headers; must not override `Content-Type`,
   * `If-None-Match`, or `x-olos-slot-id`.
   */
  additionalHeaders?: Record<string, string>;
  /**
   * Grant expiry as an ISO timestamp. Defaults to `slot.expiresAt` and
   * must not be later than it.
   */
  expiresAt?: string;
  /** Slot the grant authorizes; must be in the `issued` state. */
  slot: UploadSlot;
  /** Presigned upload URL the publisher will `PUT` the object to. */
  url: string;
}

/**
 * Build the {@link UploadGrant} handed to a publisher for an issued slot.
 * The grant is always a `PUT` and requires `Content-Type` (the slot's
 * content type), `If-None-Match: *` (create-if-absent), and
 * `x-olos-slot-id`; `additionalHeaders` are merged in but may not
 * override those. Pure; throws when the slot is not `issued`, the grant
 * would outlive the slot, or a header is invalid.
 */
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
    if (isReservedAdditionalHeader(header, reserved)) {
      throw new Error(`additionalHeaders must not override ${header}`);
    }
  }
}

function isReservedAdditionalHeader(
  header: string,
  reservedHeaders: Set<string>
): boolean {
  return reservedHeaders.has(header.toLowerCase());
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
