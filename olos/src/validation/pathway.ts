import { PATHWAY_STATES } from "../config/pathway";
import type { Pathway } from "../types/pathway";
import {
  assertAbsoluteHttpUrl,
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
