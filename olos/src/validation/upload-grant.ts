import type { UploadGrant } from "../types/upload-grant";
import { isHttpHeaderName } from "./http-header";
import { isUrlSafeIdentifier } from "./ids";

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

  assertUrlSafeField(value, "slotId");

  if (value.method !== "PUT") {
    throw new Error("uploadGrant.method must be PUT");
  }

  assertAbsoluteHttpUrl(value.url, "uploadGrant.url");
  assertIsoDateField(value, "expiresAt");

  if (value.requiredHeaders !== undefined) {
    assertStringMap(value.requiredHeaders, "uploadGrant.requiredHeaders");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertUrlSafeField(
  value: Record<string, unknown>,
  field: string
): void {
  if (!isUrlSafeIdentifier(value[field])) {
    throw new Error(
      `uploadGrant.${field} must be a non-empty URL-safe identifier`
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

function assertIsoDateField(
  value: Record<string, unknown>,
  field: string
): void {
  if (
    typeof value[field] !== "string" ||
    Number.isNaN(Date.parse(value[field]))
  ) {
    throw new Error(`uploadGrant.${field} must be a valid timestamp`);
  }
}

function assertStringMap(value: unknown, name: string): void {
  if (!isRecord(value)) {
    throw new Error(`${name} must be a string map`);
  }

  for (const [key, headerValue] of Object.entries(value)) {
    if (!isHttpHeaderName(key) || typeof headerValue !== "string") {
      throw new Error(`${name} must be a string map`);
    }
  }
}
