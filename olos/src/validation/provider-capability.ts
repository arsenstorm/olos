import {
  PROVIDER_CONSISTENCY_LEVELS,
  PROVIDER_EVENT_DELIVERY_MODES,
  PROVIDER_KINDS,
} from "../config/provider-capability";
import { OLOS_WIRE_VERSION } from "../index";
import type { ProviderCapabilityDocument } from "../types/provider-capability";
import {
  assertAbsoluteHttpUrl,
  assertBooleanField,
  assertNonEmptyStringField,
  assertOneOfField,
  assertPositiveIntegerField,
  assertUrlSafeField,
  isRecord,
} from "./fields";

const OPTIONAL_PUBLICATION_BOOLEAN_FIELDS = [
  "manifestGatedPublication",
  "readGateAvailable",
  "privateUploadPublicPromotion",
  "overwritesAllowed",
] as const;

const REQUIRED_UPLOAD_GRANT_BOOLEAN_FIELDS = [
  "exactKey",
  "methodBound",
  "contentTypeBound",
  "objectSizeCanBeObserved",
  "requiredHeadersCanBeSigned",
] as const;

const OPTIONAL_UPLOAD_GRANT_BOOLEAN_FIELDS = [
  "presignedPut",
  "temporaryCredentials",
] as const;

const OPTIONAL_DELIVERY_BOOLEAN_FIELDS = [
  "rangeRequests",
  "immutableCaching",
  "documentNavigationCanBeBlocked",
] as const;

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

  assertCapabilityPreconditions(value);
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
  assertOptionalBooleanFields(value, OPTIONAL_PUBLICATION_BOOLEAN_FIELDS, name);
}

function assertUploadGrants(value: unknown): void {
  const name = "providerCapability.uploadGrants";

  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }

  assertUploadGrantBooleanFields(value, name);
  assertUploadGrantTtl(value, name);
  assertUploadGrantMechanism(value, name);
}

function assertUploadGrantBooleanFields(
  value: Record<string, unknown>,
  name: string
): void {
  for (const field of REQUIRED_UPLOAD_GRANT_BOOLEAN_FIELDS) {
    assertBooleanField(value, field, name);
  }

  assertOptionalBooleanFields(
    value,
    OPTIONAL_UPLOAD_GRANT_BOOLEAN_FIELDS,
    name
  );
}

function assertUploadGrantTtl(
  value: Record<string, unknown>,
  name: string
): void {
  if (value.maxRecommendedTtlSeconds !== undefined) {
    assertPositiveIntegerField(value, "maxRecommendedTtlSeconds", name);
  }
}

function assertUploadGrantMechanism(
  value: Record<string, unknown>,
  name: string
): void {
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
  assertOptionalBooleanFields(value, OPTIONAL_DELIVERY_BOOLEAN_FIELDS, name);
}

function assertOptionalBooleanFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  name: string
): void {
  for (const field of fields) {
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

function assertCapabilityPreconditions(value: Record<string, unknown>): void {
  if (!usesDirectObjectPublication(value)) {
    return;
  }

  const consistency = providerCapabilityRecordField(value, "consistency");
  const delivery = providerCapabilityRecordField(value, "delivery");
  const publication = providerCapabilityRecordField(value, "publication");

  if (publication.manifestGatedPublication !== true) {
    throw new Error(
      "providerCapability.publication.manifestGatedPublication must be true for direct object publication"
    );
  }

  if (consistency.headAfterCreate !== "strong") {
    throw new Error(
      "providerCapability.consistency.headAfterCreate must be strong for direct object publication"
    );
  }

  if (publication.overwritesAllowed === true) {
    throw new Error(
      "providerCapability.publication.overwritesAllowed must not be true for direct object publication"
    );
  }

  if (delivery.negativeCachingPolicyDeclared !== true) {
    throw new Error(
      "providerCapability.delivery.negativeCachingPolicyDeclared must be true for direct object publication"
    );
  }
}

function usesDirectObjectPublication(value: Record<string, unknown>): boolean {
  return (
    isRecord(value.publication) &&
    value.publication.directObjectPublication === true
  );
}

function providerCapabilityRecordField(
  value: Record<string, unknown>,
  field: "consistency" | "delivery" | "publication"
): Record<string, unknown> {
  if (!isRecord(value[field])) {
    throw new Error(`providerCapability.${field} must be an object`);
  }

  return value[field];
}
