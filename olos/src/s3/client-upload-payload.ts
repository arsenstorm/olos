import {
  optionalRecordPayload,
  recordPayload,
  requiredRecordField,
} from "../runtime/http-client";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import {
  assertCommit,
  assertUploadGrant,
  assertUploadSlot,
} from "../validation";
import { assertCursor } from "../validation/cursor";
import type {
  S3RuntimeCommitPayloadFields,
  S3RuntimeGrantPayloadFields,
  S3RuntimeOptionalCursorPayload,
} from "./client-payload-types";
import type {
  S3RuntimeCompleteUploadResponse,
  S3RuntimeIssueUploadGrantResponse,
} from "./client-types";

const S3_UPLOAD_GRANT_RESPONSE_FIELDS_MESSAGE =
  "S3 upload grant response must include grant and slot";
const S3_UPLOAD_COMMIT_RESPONSE_FIELDS_MESSAGE =
  "S3 upload completion response must include a commit";

export function grantPayload(
  value: unknown
): Omit<S3RuntimeIssueUploadGrantResponse, "response"> {
  const fields = grantPayloadFields(value);

  return {
    grant: uploadGrantPayload(fields.grant),
    slot: uploadSlotPayload(fields.slot),
  };
}

function uploadGrantPayload(value: Record<string, unknown>): UploadGrant {
  return recordPayload<UploadGrant>(value, assertUploadGrant);
}

function uploadSlotPayload(value: Record<string, unknown>): UploadSlot {
  return recordPayload<UploadSlot>(value, assertUploadSlot);
}

function grantPayloadFields(value: unknown): S3RuntimeGrantPayloadFields {
  return {
    grant: requiredRecordField(
      value,
      "grant",
      S3_UPLOAD_GRANT_RESPONSE_FIELDS_MESSAGE
    ),
    slot: requiredRecordField(
      value,
      "slot",
      S3_UPLOAD_GRANT_RESPONSE_FIELDS_MESSAGE
    ),
  };
}

export function commitPayload(
  value: unknown
): Omit<S3RuntimeCompleteUploadResponse, "response"> {
  const fields = commitPayloadFields(value);

  return {
    commit: commitResponsePayload(fields.commit),
    ...optionalCommitPayloadCursor(value),
  };
}

function commitResponsePayload(value: Record<string, unknown>): Commit {
  return recordPayload<Commit>(value, assertCommit);
}

function commitPayloadFields(value: unknown): S3RuntimeCommitPayloadFields {
  return {
    commit: requiredRecordField(
      value,
      "commit",
      S3_UPLOAD_COMMIT_RESPONSE_FIELDS_MESSAGE
    ),
  };
}

function optionalCommitPayloadCursor(
  value: unknown
): S3RuntimeOptionalCursorPayload {
  return optionalCursorPayload(value);
}

export function optionalCursorPayload(
  value: unknown
): S3RuntimeOptionalCursorPayload {
  return optionalRecordPayload<"cursor", Cursor>(value, "cursor", assertCursor);
}
