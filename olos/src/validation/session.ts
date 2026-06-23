import {
  LATENCY_PROFILES,
  RENDITION_KINDS,
  SESSION_STATES,
} from "../config/session";
import { OLOS_WIRE_VERSION } from "../index";
import type { Rendition, Session } from "../types/session";
import {
  assertIsoDateField,
  assertNonEmptyStringField,
  assertNonNegativeIntegerField,
  assertOneOfField,
  assertPositiveIntegerField,
  assertPositiveNumberField,
  assertUrlSafeField,
  isRecord,
  nonEmptyArray,
} from "./fields";

const OPTIONAL_RENDITION_INTEGER_FIELDS = [
  "bitrate",
  "channels",
  "sampleRate",
] as const;

const RENDITION_DIMENSION_FIELDS = ["width", "height"] as const;

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
  const renditions = nonEmptyArray<Rendition>(value, "session.renditions");

  const seenRenditions = new Set<string>();

  for (const rendition of renditions) {
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
  assertOptionalRenditionMetrics(value);
}

function assertOptionalRenditionMetrics(value: Record<string, unknown>): void {
  assertOptionalPositiveIntegerFields(value, OPTIONAL_RENDITION_INTEGER_FIELDS);
  assertOptionalPositiveIntegerFields(value, RENDITION_DIMENSION_FIELDS);
  assertRenditionDimensions(value);

  if (value.frameRate !== undefined) {
    assertPositiveNumberField(value, "frameRate", "session.renditions[]");
  }
}

function assertOptionalPositiveIntegerFields(
  value: Record<string, unknown>,
  fields: readonly string[]
): void {
  for (const field of fields) {
    if (value[field] !== undefined) {
      assertPositiveIntegerField(value, field, "session.renditions[]");
    }
  }
}

function assertRenditionDimensions(value: Record<string, unknown>): void {
  if (
    (value.width === undefined && value.height !== undefined) ||
    (value.width !== undefined && value.height === undefined)
  ) {
    throw new Error(
      "session.renditions[] must define width and height together"
    );
  }
}
