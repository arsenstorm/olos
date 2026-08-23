import type { CoordinatorRetentionPlan } from "../protocol/coordinator-types";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { SessionState } from "../types/session";
import { SESSION_STATES } from "../types/session";
import type { UploadSlot } from "../types/upload-slot";
import { parseCommit } from "../validation/commit";
import { parseCursor } from "../validation/cursor";
import { errorMessage, isAllowedString, isRecord } from "../validation/fields";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { parseUploadSlot } from "../validation/upload-slot";
import {
  HEALTH_CURSOR_FRESHNESS_VALUES,
  HEALTH_LEASE_STATUS_VALUES,
  HEALTH_STATUS_VALUES,
  type RuntimeCommitUploadResponse,
  RuntimeHttpError,
  type RuntimeTransitionSessionResponse,
} from "./client-types";
import type { RuntimeLiveHealth } from "./health";
import {
  optionalParsedPayload,
  requiredArrayField,
  requiredParsedPayload,
  requiredRecordField,
  requiredRecordPayload,
  requiredStringField,
  responseBody,
} from "./http-client";
import {
  assertRuntimePublisherLease,
  type RuntimePublisherLease,
} from "./publisher-lease";
export async function assertRuntimeHttpResponseOk(
  operation: string,
  response: Response
): Promise<void> {
  if (response.ok) {
    return;
  }

  throw new RuntimeHttpError(
    `${operation} failed with status ${response.status}`,
    response,
    await responseBody(response)
  );
}

export function leasePayload(value: unknown): RuntimePublisherLease {
  return requiredRecordPayload<RuntimePublisherLease>(
    value,
    "lease",
    "publisher heartbeat response must include a lease",
    assertRuntimePublisherLease
  );
}

export function sessionIdPayload(value: unknown, context: string): string {
  return requiredStringField(
    value,
    "sessionId",
    `${context} response must include sessionId`
  );
}

export function transitionPayload(
  value: unknown
): Omit<RuntimeTransitionSessionResponse, "response"> {
  const message =
    "session transition response must include sessionId and state";
  const state = requiredStringField(value, "state", message);

  return {
    sessionId: requiredStringField(value, "sessionId", message),
    state: assertSessionState(state),
  };
}

export function slotPayload(value: unknown): UploadSlot {
  return requiredParsedPayload<UploadSlot>(
    value,
    "slot",
    "slot issue response must include a slot",
    parseUploadSlot
  );
}

export function commitPayload(
  value: unknown
): Omit<RuntimeCommitUploadResponse, "response"> {
  return {
    commit: requiredParsedPayload<Commit>(
      value,
      "commit",
      "upload commit response must include a commit",
      parseCommit
    ),
    ...optionalCursorPayload(value),
  };
}

export function optionalCursorPayload(
  value: unknown
): Pick<RuntimeCommitUploadResponse, "cursor"> | Record<string, never> {
  return optionalParsedPayload<"cursor", Cursor>(value, "cursor", parseCursor);
}

export function healthPayload(value: unknown): RuntimeLiveHealth {
  return requiredRecordPayload<RuntimeLiveHealth>(
    value,
    "health",
    "session health response must include health",
    assertRuntimeLiveHealth
  );
}

export function retentionPayload(value: unknown): CoordinatorRetentionPlan {
  return coordinatorRetentionPlanPayload(
    requiredRecordField(
      value,
      "plan",
      "session retention response must include a plan"
    )
  );
}

function coordinatorRetentionPlanPayload(
  value: Record<string, unknown>
): CoordinatorRetentionPlan {
  const cursor = optionalRetentionPlanCursor(value);

  return {
    expiredSlots: retentionPlanExpiredSlots(value),
    retiredObjects: retentionPlanRetiredObjects(value),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function retentionPlanExpiredSlots(
  value: Record<string, unknown>
): UploadSlot[] {
  return requiredArrayField(
    value,
    "expiredSlots",
    "runtime session retention plan must include expiredSlots"
  ).map((slot, index) => retentionPlanExpiredSlot(slot, index));
}

function retentionPlanExpiredSlot(value: unknown, index: number): UploadSlot {
  if (!isRecord(value)) {
    throw new Error(
      `runtime session retention plan expiredSlots[${index}] must be an object`
    );
  }

  try {
    return parseUploadSlot(value);
  } catch (error) {
    throw new Error(
      `runtime session retention plan expiredSlots[${index}] must be valid: ${errorMessage(error, String(error))}`,
      { cause: error }
    );
  }
}

function retentionPlanRetiredObjects(
  value: Record<string, unknown>
): CoordinatorRetentionPlan["retiredObjects"] {
  return requiredArrayField(
    value,
    "retiredObjects",
    "runtime session retention plan must include retiredObjects"
  ).map((retiredObject, index) =>
    retentionPlanRetiredObject(retiredObject, index)
  );
}

function retentionPlanRetiredObject(
  value: unknown,
  index: number
): CoordinatorRetentionPlan["retiredObjects"][number] {
  if (!isRecord(value)) {
    throw new Error(
      `runtime session retention plan retiredObjects[${index}] must be an object`
    );
  }

  return {
    commitId: requiredStringField(
      value,
      "commitId",
      retentionPlanRetiredObjectFieldMessage(index, "commitId")
    ),
    objectKey: requiredStringField(
      value,
      "objectKey",
      retentionPlanRetiredObjectFieldMessage(index, "objectKey")
    ),
    slotId: requiredStringField(
      value,
      "slotId",
      retentionPlanRetiredObjectFieldMessage(index, "slotId")
    ),
  };
}

export function optionalRetentionPlanCursor(
  value: Record<string, unknown>
): Cursor | undefined {
  if (value.cursor === undefined) {
    return;
  }

  if (!isRecord(value.cursor)) {
    throw new Error("runtime session retention plan cursor must be an object");
  }

  return parseCursor(value.cursor);
}

function retentionPlanRetiredObjectFieldMessage(
  index: number,
  field: "commitId" | "objectKey" | "slotId"
): string {
  return `runtime session retention plan retiredObjects[${index}].${field} must be set`;
}

function assertRuntimeLiveHealth(
  value: unknown
): asserts value is RuntimeLiveHealth {
  if (!isRecord(value)) {
    throw new Error("runtime live health must be an object");
  }

  requiredStringLiteralField(value, "cursorFreshness", {
    allowed: HEALTH_CURSOR_FRESHNESS_VALUES,
    invalidMessage:
      "session health response health.cursorFreshness must be fresh, stale, or missing",
    missingMessage:
      "session health response health must include cursorFreshness",
  });
  requiredStringLiteralField(value, "status", {
    allowed: HEALTH_STATUS_VALUES,
    invalidMessage:
      "session health response health.status must be active, stale, or starting",
    missingMessage: "session health response health must include status",
  });
  assertOptionalStringLiteralField(
    value,
    "leaseStatus",
    HEALTH_LEASE_STATUS_VALUES,
    "session health response health.leaseStatus must be active or stale"
  );
  assertOptionalFiniteNumberField(
    value,
    "cursorAgeMs",
    "session health response health.cursorAgeMs must be a finite number"
  );

  if (value.publisherInstanceId !== undefined) {
    assertUrlSafeIdentifier(
      value.publisherInstanceId,
      "session health response health.publisherInstanceId"
    );
  }
}

function requiredStringLiteralField<const Allowed extends readonly string[]>(
  value: Record<string, unknown>,
  field: string,
  messages: {
    allowed: Allowed;
    invalidMessage: string;
    missingMessage: string;
  }
): Allowed[number] {
  const { allowed, invalidMessage, missingMessage } = messages;
  const fieldValue = requiredStringField(value, field, missingMessage);

  if (!isAllowedString(fieldValue, allowed)) {
    throw new Error(invalidMessage);
  }

  return fieldValue;
}

function assertOptionalStringLiteralField<
  const Field extends string,
  const Allowed extends readonly string[],
>(
  value: Record<string, unknown>,
  field: Field,
  allowed: Allowed,
  invalidMessage: string
): void {
  const fieldValue = value[field];

  if (
    fieldValue !== undefined &&
    (typeof fieldValue !== "string" || !isAllowedString(fieldValue, allowed))
  ) {
    throw new Error(invalidMessage);
  }
}

function assertOptionalFiniteNumberField(
  value: Record<string, unknown>,
  field: string,
  invalidMessage: string
): void {
  const fieldValue = value[field];

  if (
    fieldValue !== undefined &&
    (typeof fieldValue !== "number" || !Number.isFinite(fieldValue))
  ) {
    throw new Error(invalidMessage);
  }
}

export function assertSessionState(value: string): SessionState {
  if (!isAllowedString(value, SESSION_STATES)) {
    throw new Error(
      `session transition response state must be one of: ${SESSION_STATES.join(", ")}`
    );
  }

  return value;
}
