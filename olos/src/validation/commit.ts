import type { Commit } from "../types/commit";
import { assertByterange, BYTERANGE_FIELDS } from "./byterange";
import { assertSafeDeliveryUrl } from "./delivery-url";
import {
  assertIsoDateField,
  assertKnownFieldsObject,
  assertNonEmptyStringField,
  assertNonNegativeIntegerField,
  assertPositiveIntegerField,
  assertUrlSafeField,
  type KnownFieldsShape,
  parseWithShape,
  passes,
} from "./fields";
import { assertSafeObjectKey } from "./object-key";
import { assertOptionalProfileField } from "./profile";

const COMMIT_FIELDS = [
  "byterange",
  "commitId",
  "committedAt",
  "deliveryUrl",
  "epoch",
  "etag",
  "objectKey",
  "partNumber",
  "profile",
  "sequenceNumber",
  "sessionId",
  "size",
  "slotId",
  "trackId",
] as const;

const COMMIT_SHAPE: KnownFieldsShape = {
  fields: COMMIT_FIELDS,
  nested: {
    byterange: { kind: "object", shape: { fields: BYTERANGE_FIELDS } },
  },
};

/** Returns whether `value` is a valid `Commit` (see `assertCommit`). */
export function isCommit(value: unknown): value is Commit {
  return passes(assertCommit, value);
}

/**
 * Validates an untrusted value as a wire-format `Commit`, throwing an
 * `Error` naming the first offending field. Rejects unknown fields, unsafe
 * object keys and delivery URLs, and a `byterange` on anything but a part
 * commit (`partNumber` present). `profile` is only checked to be an object.
 */
export function assertCommit(value: unknown): asserts value is Commit {
  assertKnownFieldsObject(value, COMMIT_FIELDS, "commit");
  assertCommitIdentifiers(value);
  assertCommitSequenceFields(value);
  assertCommitObjectFields(value);
  assertCommitOptionalFields(value);
}

/**
 * Tolerant read-path parser for a wire-format `Commit` (spec §11.2):
 * unknown fields — including inside `byterange` — are stripped from a fresh
 * copy, which is then validated by the unchanged closed `assertCommit` and
 * returned. Known fields are still rejected when invalid. `profile` is
 * passed through untouched.
 */
export function parseCommit(value: unknown): Commit {
  return parseWithShape(value, COMMIT_SHAPE, assertCommit);
}

function assertCommitIdentifiers(value: Record<string, unknown>): void {
  assertUrlSafeField(value, "commitId", "commit");
  assertUrlSafeField(value, "slotId", "commit");
  assertUrlSafeField(value, "sessionId", "commit");
  assertUrlSafeField(value, "trackId", "commit");
}

function assertCommitSequenceFields(value: Record<string, unknown>): void {
  assertNonNegativeIntegerField(value, "epoch", "commit");
  assertNonNegativeIntegerField(value, "sequenceNumber", "commit");

  if (value.partNumber !== undefined) {
    assertNonNegativeIntegerField(value, "partNumber", "commit");
  }
}

function assertCommitObjectFields(value: Record<string, unknown>): void {
  assertPositiveIntegerField(value, "size", "commit");
  assertSafeObjectKey(value.objectKey, "commit.objectKey");
  assertSafeDeliveryUrl(value.deliveryUrl, "commit.deliveryUrl");
  assertIsoDateField(value, "committedAt", "commit");
}

function assertCommitOptionalFields(value: Record<string, unknown>): void {
  if (value.etag !== undefined) {
    assertNonEmptyStringField(value, "etag", "commit");
  }

  assertOptionalProfileField(value, "commit");
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
