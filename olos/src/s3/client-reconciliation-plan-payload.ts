import {
  requiredArrayField,
  requiredRecord,
  requiredStringField,
} from "../runtime/http-client";
import { isStringLiteral } from "../runtime/string-literals";
import type { UploadSlot } from "../types/upload-slot";
import { assertUploadSlot } from "../validation";
import type { S3RuntimeReconciliationPlanStatus } from "./client-payload-types";
import type { StoredS3CoordinatorReconciliationPlan } from "./reconciliation";

const S3_RECONCILIATION_PLAN_RESPONSE_STATUS_MESSAGE =
  "S3 reconciliation plan response must include status";
const S3_RECONCILIATION_PLAN_RESPONSE_SLOT_IDS_MESSAGE =
  "S3 reconciliation plan response must include planned slotIds";
const S3_RECONCILIATION_PLAN_RESPONSE_SLOTS_MESSAGE =
  "S3 reconciliation plan response must include planned slots";
const S3_RECONCILIATION_PLAN_STATUS_MESSAGE =
  "S3 reconciliation plan response status must be planned or not_found";
const S3_RUNTIME_RECONCILIATION_PLAN_STATUSES = [
  "planned",
  "not_found",
] as const satisfies readonly S3RuntimeReconciliationPlanStatus[];

export function reconciliationPlanPayload(
  value: unknown
): StoredS3CoordinatorReconciliationPlan {
  const record = requiredRecord(
    value,
    S3_RECONCILIATION_PLAN_RESPONSE_STATUS_MESSAGE
  );
  const status = reconciliationPlanStatus(record);

  if (status === "not_found") {
    return missingReconciliationPlanPayload();
  }

  return plannedReconciliationPlanPayload(record);
}

function missingReconciliationPlanPayload(): StoredS3CoordinatorReconciliationPlan {
  return { status: "not_found" };
}

function plannedReconciliationPlanPayload(
  value: Record<string, unknown>
): StoredS3CoordinatorReconciliationPlan {
  return {
    status: "planned",
    slotIds: reconciliationPlanSlotIds(value),
    slots: reconciliationPlanSlots(value),
  };
}

function reconciliationPlanStatus(
  value: Record<string, unknown>
): S3RuntimeReconciliationPlanStatus {
  const status = requiredStringField(
    value,
    "status",
    S3_RECONCILIATION_PLAN_RESPONSE_STATUS_MESSAGE
  );

  if (!isReconciliationPlanStatus(status)) {
    throw new Error(S3_RECONCILIATION_PLAN_STATUS_MESSAGE);
  }

  return status;
}

function isReconciliationPlanStatus(
  status: string
): status is S3RuntimeReconciliationPlanStatus {
  return isStringLiteral(status, S3_RUNTIME_RECONCILIATION_PLAN_STATUSES);
}

function reconciliationPlanSlotIds(
  value: Record<string, unknown>
): readonly string[] {
  const slotIds = requiredArrayField(
    value,
    "slotIds",
    S3_RECONCILIATION_PLAN_RESPONSE_SLOT_IDS_MESSAGE
  );

  return slotIds.map((slotId, index) => {
    if (typeof slotId !== "string") {
      throw new Error(reconciliationPlanSlotIdContext(index));
    }

    return slotId;
  });
}

function reconciliationPlanSlotIdContext(index: number): string {
  return `S3 reconciliation plan slotIds[${index}] must be a string`;
}

function reconciliationPlanSlots(
  value: Record<string, unknown>
): readonly UploadSlot[] {
  const slots = requiredArrayField(
    value,
    "slots",
    S3_RECONCILIATION_PLAN_RESPONSE_SLOTS_MESSAGE
  );

  return slots.map((slot, index) => {
    try {
      assertUploadSlot(slot);
    } catch (error) {
      throw new Error(
        reconciliationPlanSlotValidContext(index, (error as Error).message)
      );
    }

    return slot;
  });
}

function reconciliationPlanSlotValidContext(
  index: number,
  message: string
): string {
  return `S3 reconciliation plan slots[${index}] must be valid: ${message}`;
}
