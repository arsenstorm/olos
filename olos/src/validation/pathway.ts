import { PATHWAY_STATES } from "../config/pathway";
import type { Pathway } from "../types/pathway";
import {
  assertNonNegativeIntegerField,
  assertOneOfField,
  assertUrlSafeField,
  isRecord,
} from "./fields";

export function isPathway(value: unknown): value is Pathway {
  try {
    assertPathway(value);
    return true;
  } catch {
    return false;
  }
}

export function assertPathway(value: unknown): asserts value is Pathway {
  if (!isRecord(value)) {
    throw new Error("pathway must be an object");
  }

  assertUrlSafeField(value, "pathwayId", "pathway");
  assertUrlSafeField(value, "providerId", "pathway");
  assertAbsoluteHttpUrl(value.baseUrl, "pathway.baseUrl");
  assertNonNegativeIntegerField(value, "priority", "pathway");
  assertOneOfField(value, "state", PATHWAY_STATES, "pathway");
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

  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`${name} must not contain query strings or fragments`);
  }
}
