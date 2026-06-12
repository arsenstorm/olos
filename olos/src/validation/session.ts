import {
  LATENCY_PROFILES,
  RENDITION_KINDS,
  SESSION_STATES,
} from "../config/session";
import { OLOS_WIRE_VERSION } from "../index";
import type { Rendition, Session } from "../types/session";
import { isNonNegativeInteger, isUrlSafeIdentifier } from "./ids";

export function isSession(value: unknown): value is Session {
  try {
    assertSession(value);
    return true;
  } catch {
    return false;
  }
}

export function assertSession(value: unknown): asserts value is Session {
  if (!isRecord(value)) {
    throw new Error("session must be an object");
  }

  if (value.olos !== OLOS_WIRE_VERSION) {
    throw new Error(`session.olos must be ${OLOS_WIRE_VERSION}`);
  }

  assertUrlSafeField(value, "tenantId", "session");
  assertUrlSafeField(value, "sessionId", "session");
  assertNonNegativeIntegerField(value, "epoch", "session");
  assertOneOfField(value, "state", SESSION_STATES, "session");
  assertOneOfField(value, "latencyProfile", LATENCY_PROFILES, "session");
  assertPositiveNumberField(value, "segmentTarget", "session");
  assertPositiveNumberField(value, "partTarget", "session");
  assertIsoDateField(value, "createdAt", "session");
  assertRenditions(value.renditions);
}

function assertRenditions(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("session.renditions must be a non-empty array");
  }

  const seenRenditions = new Set<string>();

  for (const rendition of value) {
    assertRendition(rendition);

    if (seenRenditions.has(rendition.renditionId)) {
      throw new Error("session.renditions must not contain duplicate IDs");
    }

    seenRenditions.add(rendition.renditionId);
  }
}

function assertRendition(value: unknown): asserts value is Rendition {
  if (!isRecord(value)) {
    throw new Error("session.renditions[] must be an object");
  }

  assertUrlSafeField(value, "renditionId", "session.renditions[]");
  assertOneOfField(value, "kind", RENDITION_KINDS, "session.renditions[]");
  assertNonEmptyStringField(value, "codec", "session.renditions[]");

  for (const field of ["bitrate", "channels", "sampleRate"] as const) {
    if (value[field] !== undefined) {
      assertPositiveIntegerField(value, field, "session.renditions[]");
    }
  }

  for (const field of ["width", "height"] as const) {
    if (value[field] !== undefined) {
      assertPositiveIntegerField(value, field, "session.renditions[]");
    }
  }

  if (value.frameRate !== undefined) {
    assertPositiveNumberField(value, "frameRate", "session.renditions[]");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertUrlSafeField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  if (!isUrlSafeIdentifier(value[field])) {
    throw new Error(`${name}.${field} must be a non-empty URL-safe identifier`);
  }
}

function assertNonNegativeIntegerField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  if (!isNonNegativeInteger(value[field])) {
    throw new Error(`${name}.${field} must be a non-negative integer`);
  }
}

function assertPositiveIntegerField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  if (!Number.isInteger(value[field]) || Number(value[field]) <= 0) {
    throw new Error(`${name}.${field} must be a positive integer`);
  }
}

function assertPositiveNumberField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  if (
    typeof value[field] !== "number" ||
    !Number.isFinite(value[field]) ||
    value[field] <= 0
  ) {
    throw new Error(`${name}.${field} must be a positive number`);
  }
}

function assertNonEmptyStringField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  if (typeof value[field] !== "string" || value[field].length === 0) {
    throw new Error(`${name}.${field} must be a non-empty string`);
  }
}

function assertIsoDateField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  if (
    typeof value[field] !== "string" ||
    Number.isNaN(Date.parse(value[field]))
  ) {
    throw new Error(`${name}.${field} must be a valid timestamp`);
  }
}

function assertOneOfField<const T extends readonly string[]>(
  value: Record<string, unknown>,
  field: string,
  allowed: T,
  name: string
): void {
  if (!allowed.includes(value[field] as T[number])) {
    throw new Error(`${name}.${field} must be one of: ${allowed.join(", ")}`);
  }
}
