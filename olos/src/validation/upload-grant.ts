import type { UploadGrant } from "../types/upload-grant";
import {
  assertAbsoluteHttpUrl,
  assertIsoDateField,
  assertUrlSafeField,
  isRecord,
} from "./fields";
import { assertHttpHeaderStringMap } from "./http-header";

/**
 * Returns whether `value` is a valid `UploadGrant` (see
 * `assertUploadGrant`).
 */
export function isUploadGrant(value: unknown): value is UploadGrant {
  try {
    assertUploadGrant(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates an untrusted value as an `UploadGrant`, throwing an `Error`
 * naming the first offending field. The method must be `PUT` and the URL an
 * absolute HTTP(S) URL; unlike delivery URLs, grant URLs may carry a query
 * string (presigned uploads).
 */
export function assertUploadGrant(
  value: unknown
): asserts value is UploadGrant {
  if (!isRecord(value)) {
    throw new Error("uploadGrant must be an object");
  }

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

function assertUploadGrantMethod(method: unknown): void {
  if (method !== "PUT") {
    throw new Error("uploadGrant.method must be PUT");
  }
}
