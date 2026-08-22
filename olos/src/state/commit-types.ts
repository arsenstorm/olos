import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { OlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { ProfileData } from "../types/profile";
import type { Session } from "../types/session";
import type { StorageObject } from "../types/storage-object";
import type { UploadSlot } from "../types/upload-slot";
import type { ObservedUpload } from "../validation/observed-upload";
import { resolveDuplicateCommit } from "./commit-mismatch";
/** Options for {@link createCommit}. */
export interface CreateCommitOptions {
  commitId: OlosId;
  /**
   * ISO timestamp of the commit. Must not be later than
   * `slot.expiresAt + lateToleranceMs`.
   */
  committedAt: string;
  /**
   * Grace period in milliseconds added to `slot.expiresAt` before a
   * commit is considered late (default 0).
   */
  lateToleranceMs?: number;
  /** Object evidence; must match the slot's key, content type, and size bounds. */
  mediaObject: StorageObject;
  /**
   * Profile data supplied with the commit (opaque to Core). Merged over
   * the slot's `profile`; commit keys win.
   */
  profile?: ProfileData;
  /** Slot being committed; must be in the `upload_observed` state. */
  slot: UploadSlot;
}

/** Options for {@link resolveUploadCommit}; same shape as {@link CreateCommitOptions}. */
export type ResolveUploadCommitOptions = CreateCommitOptions;

/** Result of {@link resolveUploadCommit}. */
export interface UploadCommitResolution {
  commit: Commit;
  /** Copy of the input slot advanced to the `committed` state. */
  slot: UploadSlot;
}

/** Options for {@link resolveCommitAttempt}. */
export interface ResolveCommitAttemptOptions
  extends Omit<CreateCommitOptions, "slot"> {
  /**
   * Current cursor. When provided, attempts whose slot position is at or
   * behind the cursor are rejected as `late_object`.
   */
  cursor?: Cursor;
  /**
   * Must be set to `true` once the object's existence has been verified
   * against the provider; otherwise the attempt is rejected as
   * `unverified_object`.
   */
  objectVerified?: true;
  /** Owning session; an `aborted` session rejects the attempt. */
  session?: Session;
  /** Slot looked up by `slotId`; omit when no slot matched. */
  slot?: UploadSlot;
  slotId: OlosId;
}

/**
 * Outcome of {@link resolveCommitAttempt}: `committed` with the commit and
 * updated slot, or a rejection status paired with a protocol error.
 */
export type CommitAttemptResolution =
  | {
      commit: Commit;
      slot: UploadSlot;
      status: "committed";
    }
  | {
      error: OlosError;
      status:
        | "content_type_mismatch"
        | "invalid_state"
        | "key_mismatch"
        | "late_object"
        | "object_too_small"
        | "object_too_large"
        | "unverified_object"
        | "unknown_slot";
    };

type ObjectSlotMismatchStatus =
  | "content_type_mismatch"
  | "key_mismatch"
  | "object_too_large"
  | "object_too_small";

export type CommitAttemptRejection = Exclude<
  CommitAttemptResolution,
  { status: "committed" }
>;

export type CommitAttemptOptionsWithSlot = ResolveCommitAttemptOptions & {
  slot: UploadSlot;
};

export interface ResolveObjectSlotMismatchOptions {
  includeKeyMismatch?: boolean;
  mediaObject: StorageObject;
  slot: UploadSlot;
}

export interface ObjectSlotMismatchResolution {
  error: OlosError;
  status: ObjectSlotMismatchStatus;
}

/** Options for {@link commitObservedUpload}. */
export interface CommitObservedUploadOptions {
  commitId: OlosId;
  /**
   * ISO timestamp of the commit. Must not be later than
   * `slot.expiresAt + lateToleranceMs`.
   */
  committedAt: string;
  /**
   * Grace period in milliseconds added to `slot.expiresAt` before the
   * observation or commit is considered late (default 0).
   */
  lateToleranceMs?: number;
  /** Provider-observed upload; must match the slot. */
  object: ObservedUpload;
  /**
   * Profile data supplied with the commit (opaque to Core). Merged over
   * the slot's `profile`; commit keys win.
   */
  profile?: ProfileData;
  /** Slot to observe and commit; must be `issued` or `upload_observed`. */
  slot: UploadSlot;
}

/** Result of {@link commitObservedUpload}. */
export interface CommitObservedUploadResult {
  commit: Commit;
  /** Copy of the input slot advanced to the `committed` state. */
  slot: UploadSlot;
}

export type ObservedUploadSlot = UploadSlot & {
  state: "upload_observed";
};

/** Options for {@link resolveDuplicateCommit}. */
export interface ResolveDuplicateCommitOptions {
  /** The retried commit for a slot that already has `existingCommit`. */
  candidateCommit: Commit;
  existingCommit: Commit;
}

/**
 * Outcome of {@link resolveDuplicateCommit}: `idempotent` keeps the
 * existing commit; `conflict` carries an `olos.duplicate_commit_conflict`
 * error.
 */
export type DuplicateCommitResolution =
  | {
      commit: Commit;
      status: "idempotent";
    }
  | {
      error: OlosError;
      status: "conflict";
    };
