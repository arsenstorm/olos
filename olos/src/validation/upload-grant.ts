import type { UploadGrant } from "../types/upload-grant";
import { assertIsoDateField, assertUrlSafeField, isRecord } from "./fields";
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

  assertAbsoluteHttpUrl(value.url, "uploadGrant.url");
  assertIsoDateField(value, "expiresAt", "uploadGrant");

  if (value.requiredHeaders !== undefined) {
    assertHttpHeaderStringMap(
      value.requiredHeaders,
      "uploadGrant.requiredHeaders"
    );
  }
}

function assertAbsoluteHttpUrl(value: unknown, name: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
}
