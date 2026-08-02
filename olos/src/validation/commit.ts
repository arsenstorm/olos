import type { Commit } from "../types/commit";
import { assertByterange, BYTERANGE_FIELDS } from "./byterange";
import { assertSafeDeliveryUrl } from "./delivery-url";
import {
  assertBooleanField,
  assertIsoDateField,
  assertNonEmptyStringField,
  assertNonNegativeIntegerField,
  assertOnlyKnownFields,
  assertPositiveIntegerField,
  assertPositiveNumberField,
  assertUrlSafeField,
  isRecord,
  type KnownFieldsShape,
  pruneUnknownFields,
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

const COMMIT_SHAPE: KnownFieldsShape = {
  fields: COMMIT_FIELDS,
  nested: {
    byterange: { kind: "object", shape: { fields: BYTERANGE_FIELDS } },
  },
};

/** Returns whether `value` is a valid `Commit` (see `assertCommit`). */
export function isCommit(value: unknown): value is Commit {
  try {
    assertCommit(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates an untrusted value as a wire-format `Commit`, throwing an
 * `Error` naming the first offending field. Rejects unknown fields, unsafe
 * object keys and delivery URLs, and a `byterange` on anything but a part
 * commit (`partNumber` present).
 */
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

/**
 * Tolerant read-path parser for a wire-format `Commit` (spec §11.2):
 * unknown fields — including inside `byterange` — are stripped from a fresh
 * copy, which is then validated by the unchanged closed `assertCommit` and
 * returned. Known fields are still rejected when invalid.
 */
export function parseCommit(value: unknown): Commit {
  const pruned = pruneUnknownFields(value, COMMIT_SHAPE);

  assertCommit(pruned);

  return pruned;
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
  assertPositiveIntegerField(value, "size", "commit");

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
