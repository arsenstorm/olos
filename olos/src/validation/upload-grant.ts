import type { UploadGrant } from "../types/upload-grant";
import {
  assertAbsoluteHttpUrl,
  assertIsoDateField,
  assertUrlSafeField,
  isRecord,
} from "./fields";
import { assertHttpHeaderStringMap } from "./http-header";

export function isUploadGrant(value: unknown): value is UploadGrant {
  try {
    assertUploadGrant(value);
    return true;
  } catch {
    return false;
  }
}

export function assertUploadGrant(
  value: unknown
): asserts value is UploadGrant {
  if (!isRecord(value)) {
    throw new Error("uploadGrant must be an object");
  }

  assertUrlSafeField(value, "slotId", "uploadGrant");

  if (value.method !== "PUT") {
    throw new Error("uploadGrant.method must be PUT");
  }

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
