import { PUBLICATION_MODES } from "../config/publication";
import type { Commit } from "../types/commit";
import { assertSafeDeliveryUrl } from "./delivery-url";
import {
  assertBooleanField,
  assertIsoDateField,
  assertNonEmptyStringField,
  assertNonNegativeIntegerField,
  assertOneOfField,
  assertPositiveNumberField,
  assertUrlSafeField,
  isRecord,
} from "./fields";
import { assertSafeObjectKey } from "./object-key";

export function isCommit(value: unknown): value is Commit {
  try {
    assertCommit(value);
    return true;
  } catch {
    return false;
  }
}

export function assertCommit(value: unknown): asserts value is Commit {
  if (!isRecord(value)) {
    throw new Error("commit must be an object");
  }

  assertCommitIdentifiers(value);
  assertCommitSequenceFields(value);
  assertCommitObjectFields(value);
  assertCommitOptionalFields(value);
  assertOneOfField(value, "publicationMode", PUBLICATION_MODES, "commit");
}

function assertCommitIdentifiers(value: Record<string, unknown>): void {
  assertUrlSafeField(value, "commitId", "commit");
  assertUrlSafeField(value, "slotId", "commit");
  assertUrlSafeField(value, "sessionId", "commit");
  assertUrlSafeField(value, "renditionId", "commit");
  assertUrlSafeField(value, "providerId", "commit");
}

function assertCommitSequenceFields(value: Record<string, unknown>): void {
  assertNonNegativeIntegerField(value, "epoch", "commit");
  assertNonNegativeIntegerField(value, "mediaSequenceNumber", "commit");

  if (value.partNumber !== undefined) {
    assertNonNegativeIntegerField(value, "partNumber", "commit");
  }
}

function assertCommitObjectFields(value: Record<string, unknown>): void {
  assertPositiveNumberField(value, "duration", "commit");
  assertPositiveNumberField(value, "size", "commit");

  assertSafeObjectKey(value.objectKey, "commit.objectKey");
  assertSafeDeliveryUrl(value.deliveryUrl, "commit.deliveryUrl");
  assertIsoDateField(value, "committedAt", "commit");
}

function assertCommitOptionalFields(value: Record<string, unknown>): void {
  assertOptionalCommitEtag(value);
  assertOptionalCommitProgramDateTime(value);
  assertOptionalCommitIndependence(value);
}

function assertOptionalCommitEtag(value: Record<string, unknown>): void {
  if (value.etag !== undefined) {
    assertNonEmptyStringField(value, "etag", "commit");
  }
}

function assertOptionalCommitProgramDateTime(
  value: Record<string, unknown>
): void {
  if (value.programDateTime !== undefined) {
    assertIsoDateField(value, "programDateTime", "commit");
  }
}

function assertOptionalCommitIndependence(
  value: Record<string, unknown>
): void {
  if (value.independent !== undefined) {
    assertBooleanField(value, "independent", "commit");
  }
}
