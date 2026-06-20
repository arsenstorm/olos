import type { CoordinatorStoreSave } from "./coordinator";

export function savedStoreResult(
  result: CoordinatorStoreSave,
  message: string
): Extract<CoordinatorStoreSave, { status: "saved" }> {
  if (result.status !== "saved") {
    throw new Error(message);
  }

  return result;
}

export function conflictingStoreResult(
  result: CoordinatorStoreSave,
  message: string
): Extract<CoordinatorStoreSave, { status: "conflict" }> {
  if (result.status !== "conflict") {
    throw new Error(message);
  }

  return result;
}
