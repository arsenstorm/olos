import {
  PROVIDER_CONSISTENCY_LEVELS,
  PROVIDER_EVENT_DELIVERY_MODES,
  PROVIDER_KINDS,
} from "../config/provider-capability";
import { OLOS_WIRE_VERSION } from "../index";
import type { ProviderCapabilityDocument } from "../types/provider-capability";
import { isUrlSafeIdentifier } from "./ids";

export function isProviderCapabilityDocument(
  value: unknown
): value is ProviderCapabilityDocument {
  try {
    assertProviderCapabilityDocument(value);
    return true;
  } catch {
    return false;
  }
}

export function assertProviderCapabilityDocument(
  value: unknown
): asserts value is ProviderCapabilityDocument {
  if (!isRecord(value)) {
    throw new Error("providerCapability must be an object");
  }

  if (value.olos !== OLOS_WIRE_VERSION) {
    throw new Error(`providerCapability.olos must be ${OLOS_WIRE_VERSION}`);
  }

  assertUrlSafeField(value, "providerId", "providerCapability");
  assertOneOfField(value, "kind", PROVIDER_KINDS, "providerCapability");

  if (value.api !== undefined) {
    assertApi(value.api);
  }

  assertConsistency(value.consistency);
  assertPublication(value.publication);
  assertUploadGrants(value.uploadGrants);
  assertDelivery(value.delivery);

  if (value.events !== undefined) {
    assertEvents(value.events);
  }

  assertCapabilityPreconditions(value as unknown as ProviderCapabilityDocument);
}

function assertApi(value: unknown): void {
  const name = "providerCapability.api";

  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }

  assertNonEmptyStringField(value, "family", name);
}

function assertConsistency(value: unknown): void {
  const name = "providerCapability.consistency";

  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }

  assertOneOfField(value, "readAfterCreate", PROVIDER_CONSISTENCY_LEVELS, name);
  assertOneOfField(value, "headAfterCreate", PROVIDER_CONSISTENCY_LEVELS, name);

  if (value.listAfterCreate !== undefined) {
    assertOneOfField(
      value,
      "listAfterCreate",
      PROVIDER_CONSISTENCY_LEVELS,
      name
    );
  }
}

function assertPublication(value: unknown): void {
  const name = "providerCapability.publication";

  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }

  assertBooleanField(value, "directObjectPublication", name);
  assertBooleanField(value, "createIfAbsent", name);

  for (const field of [
    "manifestGatedPublication",
    "readGateAvailable",
    "privateUploadPublicPromotion",
    "overwritesAllowed",
  ] as const) {
    if (value[field] !== undefined) {
      assertBooleanField(value, field, name);
    }
  }
}

function assertUploadGrants(value: unknown): void {
  const name = "providerCapability.uploadGrants";

  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }

  for (const field of [
    "presignedPut",
    "temporaryCredentials",
    "exactKey",
    "methodBound",
    "contentTypeBound",
    "requiredHeadersCanBeSigned",
  ] as const) {
    if (value[field] !== undefined) {
      assertBooleanField(value, field, name);
    }
  }

  if (value.maxRecommendedTtlSeconds !== undefined) {
    assertPositiveIntegerField(value, "maxRecommendedTtlSeconds", name);
  }

  if (!(value.presignedPut || value.temporaryCredentials)) {
    throw new Error(
      `${name} must support presignedPut or temporaryCredentials`
    );
  }
}

function assertDelivery(value: unknown): void {
  const name = "providerCapability.delivery";

  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }

  assertAbsoluteHttpUrl(value.publicBaseUrl, `${name}.publicBaseUrl`);
  assertBooleanField(value, "negativeCachingPolicyDeclared", name);

  for (const field of [
    "rangeRequests",
    "immutableCaching",
    "documentNavigationCanBeBlocked",
  ] as const) {
    if (value[field] !== undefined) {
      assertBooleanField(value, field, name);
    }
  }
}

function assertEvents(value: unknown): void {
  const name = "providerCapability.events";

  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }

  if (value.objectCreated !== undefined) {
    assertBooleanField(value, "objectCreated", name);
  }

  if (value.delivery !== undefined) {
    assertOneOfField(value, "delivery", PROVIDER_EVENT_DELIVERY_MODES, name);
  }
}

function assertCapabilityPreconditions(
  value: ProviderCapabilityDocument
): void {
  if (
    value.publication.directObjectPublication &&
    value.consistency.headAfterCreate !== "strong"
  ) {
    throw new Error(
      "providerCapability.consistency.headAfterCreate must be strong for direct object publication"
    );
  }

  if (
    value.publication.directObjectPublication &&
    value.publication.overwritesAllowed === true
  ) {
    throw new Error(
      "providerCapability.publication.overwritesAllowed must not be true for direct object publication"
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertUrlSafeField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  if (!isUrlSafeIdentifier(value[field])) {
    throw new Error(`${name}.${field} must be a non-empty URL-safe identifier`);
  }
}

function assertNonEmptyStringField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  if (typeof value[field] !== "string" || value[field].length === 0) {
    throw new Error(`${name}.${field} must be a non-empty string`);
  }
}

function assertBooleanField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  if (typeof value[field] !== "boolean") {
    throw new Error(`${name}.${field} must be a boolean`);
  }
}

function assertPositiveIntegerField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  if (!Number.isInteger(value[field]) || Number(value[field]) <= 0) {
    throw new Error(`${name}.${field} must be a positive integer`);
  }
}

function assertOneOfField<const T extends readonly string[]>(
  value: Record<string, unknown>,
  field: string,
  allowed: T,
  name: string
): void {
  if (!allowed.includes(value[field] as T[number])) {
    throw new Error(`${name}.${field} must be one of: ${allowed.join(", ")}`);
  }
}

function assertAbsoluteHttpUrl(value: unknown, name: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
}
