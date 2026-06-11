import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import type {
  StoredS3CoordinatorUploadCommit,
  StoredS3CoordinatorUploadGrantIssue,
} from "./coordinator";

export interface RunStoredS3PublisherUploadStepOptions {
  commit(slot: UploadSlot): Promise<StoredS3CoordinatorUploadCommit>;
  issueGrant(): Promise<StoredS3CoordinatorUploadGrantIssue>;
  upload(grant: UploadGrant): Promise<void>;
}

export type StoredS3PublisherUploadStep =
  | {
      commit: StoredS3CoordinatorUploadCommit;
      grant: UploadGrant;
      slot: UploadSlot;
      status: "committed" | "idempotent";
    }
  | {
      error?: string;
      issue?: Exclude<StoredS3CoordinatorUploadGrantIssue, { status: "saved" }>;
      status: "issue_failed";
    }
  | {
      error: string;
      grant: UploadGrant;
      slot: UploadSlot;
      status: "upload_failed";
    }
  | {
      commit?: StoredS3CoordinatorUploadCommit;
      error?: string;
      grant: UploadGrant;
      slot: UploadSlot;
      status: "commit_failed";
    };

export async function runStoredS3PublisherUploadStep(
  options: RunStoredS3PublisherUploadStepOptions
): Promise<StoredS3PublisherUploadStep> {
  let issued: StoredS3CoordinatorUploadGrantIssue;

  try {
    issued = await options.issueGrant();
  } catch (error) {
    return {
      error: errorMessage(error),
      status: "issue_failed",
    };
  }

  if (issued.status !== "saved") {
    return {
      issue: issued,
      status: "issue_failed",
    };
  }

  try {
    await options.upload(issued.grant);
  } catch (error) {
    return {
      error: errorMessage(error),
      grant: issued.grant,
      slot: issued.slot,
      status: "upload_failed",
    };
  }

  let committed: StoredS3CoordinatorUploadCommit;

  try {
    committed = await options.commit(issued.slot);
  } catch (error) {
    return {
      error: errorMessage(error),
      grant: issued.grant,
      slot: issued.slot,
      status: "commit_failed",
    };
  }

  if (committed.status === "committed" || committed.status === "idempotent") {
    return {
      commit: committed,
      grant: issued.grant,
      slot: issued.slot,
      status: committed.status,
    };
  }

  return {
    commit: committed,
    grant: issued.grant,
    slot: issued.slot,
    status: "commit_failed",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "S3 publisher step failed";
}
