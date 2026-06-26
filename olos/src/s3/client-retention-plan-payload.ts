import { isRecord, requiredArrayField } from "../runtime/http-client";
import type { Cursor } from "../types/cursor";
import type { UploadSlot } from "../types/upload-slot";
import { assertUploadSlot } from "../validation";
import { assertCursor } from "../validation/cursor";
import type {
  S3RuntimeRetentionExpiredSlotsPayload,
  S3RuntimeRetentionRetiredObjectsPayload,
} from "./client-payload-types";
import { retentionRetiredObjectCollectionPayload } from "./client-retention-result-payload";
import type { StoredS3CoordinatorRetentionResponse } from "./http-types";

const S3_RETENTION_PLAN_EXPIRED_SLOTS_MESSAGE =
  "S3 retention response plan must include expiredSlots";
const S3_RETENTION_PLAN_RETIRED_OBJECTS_MESSAGE =
  "S3 retention response plan must include retiredObjects";
const S3_RETENTION_PLAN_CURSOR_MESSAGE =
  "S3 retention response plan cursor must be an object";

export function retentionPlanPayload(
  value: unknown
): StoredS3CoordinatorRetentionResponse["plan"] {
  if (!isRecord(value)) {
    throw new Error("S3 retention response plan must be an object");
  }

  const parsedExpiredSlots = retentionPlanExpiredSlotsPayload(value);

  const parsedRetiredObjects = retentionPlanRetiredObjectsPayload(value);

  const cursor = optionalRetentionPlanCursor(value);

  return {
    expiredSlots: parsedExpiredSlots,
    retiredObjects: parsedRetiredObjects,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function retentionPlanExpiredSlotsPayload(
  value: Record<string, unknown>
): S3RuntimeRetentionExpiredSlotsPayload {
  return requiredArrayField(
    value,
    "expiredSlots",
    S3_RETENTION_PLAN_EXPIRED_SLOTS_MESSAGE
  ).map((slot, index) => retentionExpiredSlotPayload(slot, index));
}

function retentionPlanRetiredObjectsPayload(
  value: Record<string, unknown>
): S3RuntimeRetentionRetiredObjectsPayload {
  return retentionRetiredObjectCollectionPayload(
    value,
    "retiredObjects",
    S3_RETENTION_PLAN_RETIRED_OBJECTS_MESSAGE,
    "S3 retention response plan.retiredObjects"
  );
}

function retentionExpiredSlotPayload(
  value: unknown,
  index: number
): UploadSlot {
  if (!isRecord(value)) {
    throw new Error(retentionExpiredSlotObjectContext(index));
  }

  try {
    assertUploadSlot(value);
  } catch (error) {
    throw new Error(
      retentionExpiredSlotValidContext(index, (error as Error).message)
    );
  }

  return value;
}

function retentionExpiredSlotObjectContext(index: number): string {
  return `S3 retention response plan.expiredSlots[${index}] must be an object`;
}

function retentionExpiredSlotValidContext(
  index: number,
  message: string
): string {
  return `S3 retention response plan.expiredSlots[${index}] must be valid: ${message}`;
}

function optionalRetentionPlanCursor(
  value: Record<string, unknown>
): Cursor | undefined {
  if (value.cursor === undefined) {
    return;
  }

  if (!isRecord(value.cursor)) {
    throw new Error(S3_RETENTION_PLAN_CURSOR_MESSAGE);
  }

  assertCursor(value.cursor);
  return value.cursor;
}
