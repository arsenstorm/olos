import type { UploadSlot } from "../types/upload-slot";
import type {
  RuntimeCommitPayload,
  RuntimeObservedUploadPayload,
} from "./commit";
import type { RuntimeSlotIssuePayload } from "./slot";

export interface RuntimePublisherIssueResult {
  slot?: UploadSlot;
  status: string;
}

export interface RuntimePublisherCommitResult {
  status: string;
}

export interface RunRuntimePublisherUploadStepOptions {
  commit(payload: RuntimeCommitPayload): Promise<RuntimePublisherCommitResult>;
  commitId: string;
  committedAt: string;
  independent?: boolean;
  issueSlot(
    payload: RuntimeSlotIssuePayload
  ): Promise<RuntimePublisherIssueResult>;
  maxSegments?: number;
  programDateTime?: string;
  slot: RuntimeSlotIssuePayload;
  upload(slot: UploadSlot): Promise<RuntimeObservedUploadPayload>;
}

export type RuntimePublisherUploadStep =
  | {
      commit: RuntimePublisherCommitResult;
      observed: RuntimeObservedUploadPayload;
      slot: UploadSlot;
      status: "committed" | "idempotent";
    }
  | {
      error?: string;
      issue?: RuntimePublisherIssueResult;
      status: "issue_failed";
    }
  | {
      error: string;
      slot: UploadSlot;
      status: "upload_failed";
    }
  | {
      commit?: RuntimePublisherCommitResult;
      error?: string;
      observed: RuntimeObservedUploadPayload;
      slot: UploadSlot;
      status: "commit_failed";
    };

export async function runRuntimePublisherUploadStep(
  options: RunRuntimePublisherUploadStepOptions
): Promise<RuntimePublisherUploadStep> {
  let issued: RuntimePublisherIssueResult;

  try {
    issued = await options.issueSlot(options.slot);
  } catch (error) {
    return {
      error: errorMessage(error),
      status: "issue_failed",
    };
  }

  if (issued.status !== "issued" || issued.slot === undefined) {
    return {
      issue: issued,
      status: "issue_failed",
    };
  }

  let observed: RuntimeObservedUploadPayload;

  try {
    observed = await options.upload(issued.slot);
  } catch (error) {
    return {
      error: errorMessage(error),
      slot: issued.slot,
      status: "upload_failed",
    };
  }

  let committed: RuntimePublisherCommitResult;

  try {
    committed = await options.commit({
      commitId: options.commitId,
      committedAt: options.committedAt,
      object: observed,
      slotId: issued.slot.slotId,
      ...optionalBoolean("independent", options.independent),
      ...optionalNumber("maxSegments", options.maxSegments),
      ...optionalString("programDateTime", options.programDateTime),
    });
  } catch (error) {
    return {
      error: errorMessage(error),
      observed,
      slot: issued.slot,
      status: "commit_failed",
    };
  }

  if (committed.status === "committed" || committed.status === "idempotent") {
    return {
      commit: committed,
      observed,
      slot: issued.slot,
      status: committed.status,
    };
  }

  return {
    commit: committed,
    observed,
    slot: issued.slot,
    status: "commit_failed",
  };
}

function optionalBoolean<Key extends string>(
  key: Key,
  value: boolean | undefined
): Partial<Record<Key, boolean>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, boolean>);
}

function optionalNumber<Key extends string>(
  key: Key,
  value: number | undefined
): Partial<Record<Key, number>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, number>);
}

function optionalString<Key extends string>(
  key: Key,
  value: string | undefined
): Partial<Record<Key, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, string>);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "publisher upload failed";
}
