import { requiredRecordField } from "../runtime/http-client";
import { parseCommit } from "../validation/commit";
import { parseUploadGrant } from "../validation/upload-grant";
import { parseUploadSlot } from "../validation/upload-slot";
import { optionalCursorPayload } from "./client-payload-shared";
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
  return {
    grant: parseUploadGrant(
      requiredRecordField(
        value,
        "grant",
        S3_UPLOAD_GRANT_RESPONSE_FIELDS_MESSAGE
      )
    ),
    slot: parseUploadSlot(
      requiredRecordField(
        value,
        "slot",
        S3_UPLOAD_GRANT_RESPONSE_FIELDS_MESSAGE
      )
    ),
  };
}

export function commitPayload(
  value: unknown
): Omit<S3RuntimeCompleteUploadResponse, "response"> {
  return {
    commit: parseCommit(
      requiredRecordField(
        value,
        "commit",
        S3_UPLOAD_COMMIT_RESPONSE_FIELDS_MESSAGE
      )
    ),
    ...optionalCursorPayload(value),
  };
}
