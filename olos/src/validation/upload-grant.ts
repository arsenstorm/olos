import type { UploadGrant } from "../types/upload-grant";
import {
  assertIsoDateField,
  assertKnownFieldsObject,
  assertUrlSafeField,
  type KnownFieldsShape,
  parseWithShape,
  passes,
} from "./fields";
import { assertHttpHeaderStringMap } from "./http-header";
import { assertAbsoluteHttpUrl } from "./http-url";

const UPLOAD_GRANT_FIELDS = [
  "expiresAt",
  "method",
  "requiredHeaders",
  "slotId",
  "url",
] as const;

// `requiredHeaders` is a free-form header map, so it needs no nested shape:
// its keys are header names, not schema fields.
const UPLOAD_GRANT_SHAPE: KnownFieldsShape = {
  fields: UPLOAD_GRANT_FIELDS,
};

/**
 * Returns whether `value` is a valid `UploadGrant` (see
 * `assertUploadGrant`).
 */
export function isUploadGrant(value: unknown): value is UploadGrant {
  return passes(assertUploadGrant, value);
}

/**
 * Validates an untrusted value as an `UploadGrant`, throwing an `Error`
 * naming the first offending field. Rejects unknown fields; the method must
 * be `PUT` and the URL an absolute HTTP(S) URL — unlike delivery URLs,
 * grant URLs may carry a query string (presigned uploads).
 */
export function assertUploadGrant(
  value: unknown
): asserts value is UploadGrant {
  assertKnownFieldsObject(value, UPLOAD_GRANT_FIELDS, "uploadGrant");
  assertUrlSafeField(value, "slotId", "uploadGrant");
  assertUploadGrantMethod(value.method);

  assertAbsoluteHttpUrl(value.url, "uploadGrant.url", {
    allowQueryOrFragment: true,
  });
  assertIsoDateField(value, "expiresAt", "uploadGrant");
  if (value.requiredHeaders !== undefined) {
    assertHttpHeaderStringMap(
      value.requiredHeaders,
      "uploadGrant.requiredHeaders"
    );
  }
}

/**
 * Tolerant read-path parser for an `UploadGrant` (spec §11.2): unknown
 * fields are stripped from a fresh copy, which is then validated by the
 * unchanged closed `assertUploadGrant` and returned. Known fields are still
 * rejected when invalid.
 */
export function parseUploadGrant(value: unknown): UploadGrant {
  return parseWithShape(value, UPLOAD_GRANT_SHAPE, assertUploadGrant);
}

function assertUploadGrantMethod(method: unknown): void {
  if (method !== "PUT") {
    throw new Error("uploadGrant.method must be PUT");
  }
}
