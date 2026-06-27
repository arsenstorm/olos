import type { Commit } from "../types/commit";
import { assertByterange } from "./byterange";
import { assertSafeDeliveryUrl } from "./delivery-url";
import {
  assertBooleanField,
  assertIsoDateField,
  assertNonEmptyStringField,
  assertNonNegativeIntegerField,
  assertOnlyKnownFields,
  assertPositiveNumberField,
  assertUrlSafeField,
  isRecord,
} from "./fields";
import { assertSafeObjectKey } from "./object-key";

const COMMIT_FIELDS = [
  "byterange",
  "commitId",
  "committedAt",
  "deliveryUrl",
  "duration",
  "epoch",
  "etag",
  "independent",
  "mediaSequenceNumber",
  "objectKey",
  "partNumber",
  "programDateTime",
  "renditionId",
  "sessionId",
  "size",
  "slotId",
] as const;

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

  assertOnlyKnownFields(value, COMMIT_FIELDS, "commit");
  assertCommitIdentifiers(value);
  assertCommitSequenceFields(value);
  assertCommitObjectFields(value);
  assertCommitOptionalFields(value);
}

function assertCommitIdentifiers(value: Record<string, unknown>): void {
  assertUrlSafeField(value, "commitId", "commit");
  assertUrlSafeField(value, "slotId", "commit");
  assertUrlSafeField(value, "sessionId", "commit");
  assertUrlSafeField(value, "renditionId", "commit");
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
  assertOptionalCommitByterange(value);
}

function assertOptionalCommitByterange(value: Record<string, unknown>): void {
  if (value.byterange === undefined) {
    return;
  }

  assertByterange(value.byterange, "commit.byterange");
  // A part-kind commit is the only thing OLOS lets carry a byterange. Slot
  // issuance enforces it; we re-check here so a hand-rolled commit can't
  // smuggle a byterange onto a segment commit.
  if (value.partNumber === undefined) {
    throw new Error(
      "commit.byterange may only be set when partNumber is present"
    );
  }
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
