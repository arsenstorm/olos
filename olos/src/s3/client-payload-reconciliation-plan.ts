import {
  requiredArrayField,
  requiredRecord,
  requiredStringField,
} from "../runtime/http-client";
import type { UploadSlot } from "../types/upload-slot";
import { errorMessage, isAllowedString } from "../validation/fields";
import { parseUploadSlot } from "../validation/upload-slot";
import { indexedFieldContext } from "./client-payload-shared";
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
const S3_RECONCILIATION_PLAN_SLOT_IDS_CONTEXT =
  "S3 reconciliation plan slotIds";
const S3_RECONCILIATION_PLAN_SLOTS_CONTEXT = "S3 reconciliation plan slots";

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
  return isAllowedString(status, S3_RUNTIME_RECONCILIATION_PLAN_STATUSES);
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
      throw new Error(
        `${indexedFieldContext(S3_RECONCILIATION_PLAN_SLOT_IDS_CONTEXT, index)} must be a string`
      );
    }

    return slotId;
  });
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
      return parseUploadSlot(slot);
    } catch (error) {
      throw new Error(
        `${indexedFieldContext(S3_RECONCILIATION_PLAN_SLOTS_CONTEXT, index)} must be valid: ${errorMessage(error, String(error))}`
      );
    }
  });
}
