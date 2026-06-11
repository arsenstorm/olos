import { PATHWAY_STATES } from "../config/pathway";
import type { Pathway } from "../types/pathway";
import { isNonNegativeInteger, isUrlSafeIdentifier } from "./ids";

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

  assertUrlSafeField(value, "pathwayId");
  assertUrlSafeField(value, "providerId");
  assertAbsoluteHttpUrl(value.baseUrl, "pathway.baseUrl");
  assertNonNegativeIntegerField(value, "priority");
  assertAllowedValue(value.state, PATHWAY_STATES, "pathway.state");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertUrlSafeField(
  value: Record<string, unknown>,
  field: string
): void {
  if (!isUrlSafeIdentifier(value[field])) {
    throw new Error(`pathway.${field} must be a non-empty URL-safe identifier`);
  }
}

function assertNonNegativeIntegerField(
  value: Record<string, unknown>,
  field: string
): void {
  if (!isNonNegativeInteger(value[field])) {
    throw new Error(`pathway.${field} must be a non-negative integer`);
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

function assertAllowedValue<const Values extends readonly string[]>(
  value: unknown,
  allowedValues: Values,
  name: string
): void {
  if (typeof value !== "string" || !allowedValues.includes(value)) {
    throw new Error(`${name} must be one of: ${allowedValues.join(", ")}`);
  }
}
