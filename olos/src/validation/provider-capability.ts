import type { ProviderCapabilityDocument } from "../types/provider-capability";
import {
  PROVIDER_CONSISTENCY_LEVELS,
  PROVIDER_EVENT_DELIVERY_MODES,
  PROVIDER_KINDS,
} from "../types/provider-capability";
import { OLOS_WIRE_VERSION } from "../types/session";
import {
  assertBooleanField,
  assertKnownFieldsObject,
  assertNonEmptyStringField,
  assertOneOfField,
  assertOnlyKnownFields,
  assertOptionalFields,
  assertPositiveIntegerField,
  assertUrlSafeField,
  isRecord,
  passes,
} from "./fields";
import { assertAbsoluteHttpUrl } from "./http-url";

const PROVIDER_CAPABILITY_FIELDS = [
  "api",
  "consistency",
  "delivery",
  "events",
  "kind",
  "olos",
  "providerId",
  "publication",
  "uploadGrants",
] as const;

const PROVIDER_API_FIELDS = ["family"] as const;

const PROVIDER_CONSISTENCY_FIELDS = [
  "observeAfterCreate",
  "listAfterCreate",
  "readAfterCreate",
] as const;

const PROVIDER_PUBLICATION_FIELDS = [
  "createIfAbsent",
  "directObjectPublication",
  "manifestGatedPublication",
  "overwritesAllowed",
  "privateUploadPublicPromotion",
  "readGateAvailable",
] as const;

const PROVIDER_UPLOAD_GRANT_FIELDS = [
  "contentTypeBound",
  "exactKey",
  "maxRecommendedTtlSeconds",
  "methodBound",
  "objectSizeCanBeObserved",
  "presignedPut",
  "requiredHeadersCanBeSigned",
  "temporaryCredentials",
] as const;

const PROVIDER_DELIVERY_FIELDS = [
  "documentNavigationCanBeBlocked",
  "immutableCaching",
  "negativeCachingPolicyDeclared",
  "publicBaseUrl",
  "rangeRequests",
] as const;

const PROVIDER_EVENTS_FIELDS = ["delivery", "objectCreated"] as const;

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

interface DirectPublicationPreconditionContext {
  consistency: Record<string, unknown>;
  delivery: Record<string, unknown>;
  publication: Record<string, unknown>;
}

interface DirectPublicationPrecondition {
  isSatisfied: (context: DirectPublicationPreconditionContext) => boolean;
  message: string;
}

const DIRECT_PUBLICATION_PRECONDITIONS = [
  {
    isSatisfied: ({ publication }) =>
      publication.manifestGatedPublication === true,
    message:
      "providerCapability.publication.manifestGatedPublication must be true for direct object publication",
  },
  {
    isSatisfied: ({ consistency }) =>
      consistency.observeAfterCreate === "strong",
    message:
      "providerCapability.consistency.observeAfterCreate must be strong for direct object publication",
  },
  {
    isSatisfied: ({ publication }) => publication.overwritesAllowed !== true,
    message:
      "providerCapability.publication.overwritesAllowed must not be true for direct object publication",
  },
  {
    isSatisfied: ({ delivery }) =>
      delivery.negativeCachingPolicyDeclared === true,
    message:
      "providerCapability.delivery.negativeCachingPolicyDeclared must be true for direct object publication",
  },
] satisfies readonly DirectPublicationPrecondition[];

/**
 * Returns whether `value` is a valid `ProviderCapabilityDocument` (see
 * `assertProviderCapabilityDocument`).
 */
export function isProviderCapabilityDocument(
  value: unknown
): value is ProviderCapabilityDocument {
  return passes(assertProviderCapabilityDocument, value);
}

/**
 * Validates an untrusted value as a `ProviderCapabilityDocument`, throwing
 * an `Error` naming the first offending field. Rejects unknown fields at
 * the top level and inside every sub-object, checks the `olos` wire
 * version and, when the provider declares `directObjectPublication`,
 * enforces its preconditions: strong `observeAfterCreate` consistency,
 * manifest-gated publication, no overwrites, and a declared
 * negative-caching policy.
 */
export function assertProviderCapabilityDocument(
  value: unknown
): asserts value is ProviderCapabilityDocument {
  if (!isRecord(value)) {
    throw new Error("providerCapability must be an object");
  }

  if (value.olos !== OLOS_WIRE_VERSION) {
    throw new Error(`providerCapability.olos must be ${OLOS_WIRE_VERSION}`);
  }

  assertOnlyKnownFields(
    value,
    PROVIDER_CAPABILITY_FIELDS,
    "providerCapability"
  );
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

  assertCapabilityPreconditions(value, {
    consistency: value.consistency,
    delivery: value.delivery,
    publication: value.publication,
  });
}

function assertApi(value: unknown): void {
  const name = "providerCapability.api";

  assertKnownFieldsObject(value, PROVIDER_API_FIELDS, name);
  assertNonEmptyStringField(value, "family", name);
}

function assertConsistency(
  value: unknown
): asserts value is Record<string, unknown> {
  const name = "providerCapability.consistency";

  assertKnownFieldsObject(value, PROVIDER_CONSISTENCY_FIELDS, name);
  assertOneOfField(value, "readAfterCreate", PROVIDER_CONSISTENCY_LEVELS, name);
  assertOneOfField(
    value,
    "observeAfterCreate",
    PROVIDER_CONSISTENCY_LEVELS,
    name
  );
  assertOptionalOneOfField(
    value,
    "listAfterCreate",
    PROVIDER_CONSISTENCY_LEVELS,
    name
  );
}

function assertPublication(
  value: unknown
): asserts value is Record<string, unknown> {
  const name = "providerCapability.publication";

  assertKnownFieldsObject(value, PROVIDER_PUBLICATION_FIELDS, name);
  assertBooleanField(value, "directObjectPublication", name);
  assertBooleanField(value, "createIfAbsent", name);
  assertOptionalBooleanFields(value, OPTIONAL_PUBLICATION_BOOLEAN_FIELDS, name);
}

function assertUploadGrants(value: unknown): void {
  const name = "providerCapability.uploadGrants";

  assertKnownFieldsObject(value, PROVIDER_UPLOAD_GRANT_FIELDS, name);
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

function assertDelivery(
  value: unknown
): asserts value is Record<string, unknown> {
  const name = "providerCapability.delivery";

  assertKnownFieldsObject(value, PROVIDER_DELIVERY_FIELDS, name);
  assertAbsoluteHttpUrl(value.publicBaseUrl, `${name}.publicBaseUrl`);
  assertBooleanField(value, "negativeCachingPolicyDeclared", name);
  assertOptionalBooleanFields(value, OPTIONAL_DELIVERY_BOOLEAN_FIELDS, name);
}

function assertOptionalBooleanFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  name: string
): void {
  assertOptionalFields(value, fields, (_value, field) =>
    assertBooleanField(value, field, name)
  );
}

function assertEvents(value: unknown): void {
  const name = "providerCapability.events";

  assertKnownFieldsObject(value, PROVIDER_EVENTS_FIELDS, name);

  if (value.objectCreated !== undefined) {
    assertBooleanField(value, "objectCreated", name);
  }

  assertOptionalOneOfField(
    value,
    "delivery",
    PROVIDER_EVENT_DELIVERY_MODES,
    name
  );
}

function assertOptionalOneOfField(
  value: Record<string, unknown>,
  field: string,
  values: readonly string[],
  name: string
): void {
  if (value[field] !== undefined) {
    assertOneOfField(value, field, values, name);
  }
}

function assertCapabilityPreconditions(
  value: Record<string, unknown>,
  context: DirectPublicationPreconditionContext
): void {
  if (!usesDirectObjectPublication(value)) {
    return;
  }

  assertDirectPublicationPreconditions(context);
}

function assertDirectPublicationPreconditions(
  context: DirectPublicationPreconditionContext
): void {
  for (const precondition of DIRECT_PUBLICATION_PRECONDITIONS) {
    if (!precondition.isSatisfied(context)) {
      throw new Error(precondition.message);
    }
  }
}

function usesDirectObjectPublication(value: Record<string, unknown>): boolean {
  return (
    isRecord(value.publication) &&
    value.publication.directObjectPublication === true
  );
}
