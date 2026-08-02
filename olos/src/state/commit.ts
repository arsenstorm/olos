import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { OlosError } from "../types/errors";
import { createOlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { MediaObject } from "../types/media-object";
import type { Session } from "../types/session";
import type { UploadSlot } from "../types/upload-slot";
import { assertCommit } from "../validation/commit";
import { nonNegativeNumber, timestampMs } from "../validation/fields";
import {
  assertObservedUpload,
  type ObservedUpload,
} from "../validation/observed-upload";
import { assertUploadSlot } from "../validation/upload-slot";
import { assertUploadSlotTransition, observeUpload } from "./upload-slot";

/** Options for {@link createCommit}. */
export interface CreateCommitOptions {
  commitId: OlosId;
  /**
   * ISO timestamp of the commit. Must not be later than
   * `slot.expiresAt + lateToleranceMs`.
   */
  committedAt: string;
  /** Whether the committed part starts with an independent frame. */
  independent?: boolean;
  /**
   * Grace period in milliseconds added to `slot.expiresAt` before a
   * commit is considered late (default 0).
   */
  lateToleranceMs?: number;
  /** Object evidence; must match the slot's key, content type, and size bounds. */
  mediaObject: MediaObject;
  /** ISO timestamp surfaced as `EXT-X-PROGRAM-DATE-TIME`. */
  programDateTime?: string;
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

type CommitAttemptRejection = Exclude<
  CommitAttemptResolution,
  { status: "committed" }
>;

type CommitAttemptOptionsWithSlot = ResolveCommitAttemptOptions & {
  slot: UploadSlot;
};

export interface ResolveObjectSlotMismatchOptions {
  includeKeyMismatch?: boolean;
  mediaObject: MediaObject;
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
  /** Whether the committed part starts with an independent frame. */
  independent?: boolean;
  /**
   * Grace period in milliseconds added to `slot.expiresAt` before the
   * observation or commit is considered late (default 0).
   */
  lateToleranceMs?: number;
  /** Provider-observed upload; must match the slot. */
  object: ObservedUpload;
  /** ISO timestamp surfaced as `EXT-X-PROGRAM-DATE-TIME`. */
  programDateTime?: string;
  /** Slot to observe and commit; must be `issued` or `upload_observed`. */
  slot: UploadSlot;
}

/** Result of {@link commitObservedUpload}. */
export interface CommitObservedUploadResult {
  commit: Commit;
  /** Copy of the input slot advanced to the `committed` state. */
  slot: UploadSlot;
}

type ObservedUploadSlot = UploadSlot & {
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

/**
 * Build the immutable {@link Commit} record for an observed upload. Pure —
 * the slot is not modified; use {@link resolveUploadCommit} to also advance
 * the slot to `committed`. Throws when the slot is not `upload_observed`,
 * the object's key or content type does not match the slot, the size is
 * outside the slot's `minBytes`/`maxBytes` bounds, or `committedAt` is
 * later than `slot.expiresAt + lateToleranceMs`.
 */
export function createCommit(options: CreateCommitOptions): Commit {
  assertUploadSlot(options.slot);
  // Observed-upload validation: commit evidence may carry the provider
  // `metadata` map, which the closed wire `MediaObject` validator rejects.
  assertObservedUpload(options.mediaObject);
  assertCommitPreconditions(options);

  const commit: Commit = {
    ...(options.slot.byterange === undefined
      ? {}
      : { byterange: options.slot.byterange }),
    commitId: options.commitId,
    committedAt: options.committedAt,
    deliveryUrl: options.slot.deliveryUrl,
    duration: options.slot.duration,
    epoch: options.slot.epoch,
    ...(options.mediaObject.etag === undefined
      ? {}
      : { etag: options.mediaObject.etag }),
    ...(options.independent === undefined
      ? {}
      : { independent: options.independent }),
    mediaSequenceNumber: options.slot.mediaSequenceNumber,
    objectKey: options.slot.objectKey,
    ...(options.slot.partNumber === undefined
      ? {}
      : { partNumber: options.slot.partNumber }),
    ...(options.programDateTime === undefined
      ? {}
      : { programDateTime: options.programDateTime }),
    renditionId: options.slot.renditionId,
    sessionId: options.slot.sessionId,
    size: options.mediaObject.size,
    slotId: options.slot.slotId,
  };

  assertCommit(commit);
  return commit;
}

/**
 * Observe an upload and commit it in one step: advances the slot to
 * `upload_observed` (via {@link observeUpload}) and then to `committed`
 * (via {@link resolveUploadCommit}). Pure — returns new slot copies.
 * Throws when the observed object does not match the slot or a commit
 * precondition fails.
 */
export function commitObservedUpload(
  options: CommitObservedUploadOptions
): CommitObservedUploadResult {
  const slot = observeUpload({
    lateToleranceMs: options.lateToleranceMs,
    object: options.object,
    slot: options.slot,
  });

  return resolveUploadCommit({
    commitId: options.commitId,
    committedAt: options.committedAt,
    independent: options.independent,
    lateToleranceMs: options.lateToleranceMs,
    mediaObject: options.object,
    programDateTime: options.programDateTime,
    slot,
  });
}

/**
 * Commit an observed upload: builds the {@link Commit} via
 * {@link createCommit} and returns a copy of the slot advanced to the
 * `committed` state. Pure; throws when a commit precondition fails or the
 * slot cannot transition to `committed`.
 */
export function resolveUploadCommit(
  options: ResolveUploadCommitOptions
): UploadCommitResolution {
  const commit = createCommit(options);

  assertUploadSlotTransition(options.slot.state, "committed");

  return {
    commit,
    slot: {
      ...options.slot,
      state: "committed",
    },
  };
}

/**
 * Resolve a full commit attempt without throwing on protocol-level
 * failures. Returns `committed` with the commit and updated slot on
 * success; otherwise a rejection: `unknown_slot` (no `slot` supplied),
 * `invalid_state` (session is aborted), `unverified_object`
 * (`objectVerified` not set), `late_object` (slot position at or behind
 * the cursor), or `key_mismatch` / `content_type_mismatch` /
 * `object_too_large` / `object_too_small` (object does not satisfy the
 * slot's constraints). Pure; still throws on structurally invalid inputs.
 */
export function resolveCommitAttempt(
  options: ResolveCommitAttemptOptions
): CommitAttemptResolution {
  const slot = options.slot;

  if (slot === undefined) {
    return unknownSlotCommitAttempt(options.slotId);
  }

  const precondition = resolveCommitAttemptPrecondition({
    ...options,
    slot,
  });

  if (precondition !== undefined) {
    return precondition;
  }

  const mismatch = resolveObjectSlotMismatch({
    includeKeyMismatch: true,
    mediaObject: options.mediaObject,
    slot,
  });

  if (mismatch !== undefined) {
    return mismatch;
  }

  const result = resolveUploadCommit({
    commitId: options.commitId,
    committedAt: options.committedAt,
    independent: options.independent,
    lateToleranceMs: options.lateToleranceMs,
    mediaObject: options.mediaObject,
    programDateTime: options.programDateTime,
    slot,
  });

  return {
    ...result,
    status: "committed",
  };
}

function unknownSlotCommitAttempt(slotId: OlosId): CommitAttemptRejection {
  return {
    error: createOlosError("olos.unknown_slot", "upload slot is unknown", {
      slotId,
    }),
    status: "unknown_slot",
  };
}

function resolveCommitAttemptPrecondition(
  options: CommitAttemptOptionsWithSlot
): CommitAttemptRejection | undefined {
  if (options.session?.state === "aborted") {
    return abortedSessionCommitAttempt(options);
  }

  if (options.objectVerified !== true) {
    return unverifiedObjectCommitAttempt(options);
  }

  if (
    options.cursor !== undefined &&
    isLateSlot(options.slot, options.cursor)
  ) {
    return lateObjectCommitAttempt(options);
  }
}

function abortedSessionCommitAttempt(
  options: CommitAttemptOptionsWithSlot
): CommitAttemptRejection {
  return {
    error: createOlosError("olos.invalid_state", "session is aborted", {
      sessionId: options.session?.sessionId,
      slotId: options.slot.slotId,
      state: options.session?.state,
    }),
    status: "invalid_state",
  };
}

function unverifiedObjectCommitAttempt(
  options: CommitAttemptOptionsWithSlot
): CommitAttemptRejection {
  return {
    error: createOlosError(
      "olos.invalid_state",
      "object existence is unverified",
      {
        objectKey: options.mediaObject.objectKey,
        slotId: options.slot.slotId,
      }
    ),
    status: "unverified_object",
  };
}

function lateObjectCommitAttempt(
  options: CommitAttemptOptionsWithSlot
): CommitAttemptRejection {
  return {
    error: createOlosError(
      "olos.invalid_state",
      "object is behind the current cursor",
      {
        cursorLastMediaSequenceNumber:
          options.cursor?.window.lastMediaSequenceNumber,
        cursorLastPartNumber: options.cursor?.window.lastPartNumber,
        mediaSequenceNumber: options.slot.mediaSequenceNumber,
        partNumber: options.slot.partNumber,
        slotId: options.slot.slotId,
      }
    ),
    status: "late_object",
  };
}

export function resolveObjectSlotMismatch(
  options: ResolveObjectSlotMismatchOptions
): ObjectSlotMismatchResolution | undefined {
  if (
    options.includeKeyMismatch === true &&
    options.mediaObject.objectKey !== options.slot.objectKey
  ) {
    return keyMismatch(options);
  }

  if (options.mediaObject.contentType !== options.slot.contentType) {
    return contentTypeMismatch(options);
  }

  if (options.mediaObject.size > options.slot.maxBytes) {
    return objectTooLarge(options);
  }

  if (
    options.slot.minBytes !== undefined &&
    options.mediaObject.size < options.slot.minBytes
  ) {
    return objectTooSmall(options);
  }
}

function keyMismatch(
  options: ResolveObjectSlotMismatchOptions
): ObjectSlotMismatchResolution {
  return {
    error: createOlosError(
      "olos.key_mismatch",
      "object key does not match slot",
      {
        objectKey: options.mediaObject.objectKey,
        slotId: options.slot.slotId,
        slotObjectKey: options.slot.objectKey,
      }
    ),
    status: "key_mismatch",
  };
}

function contentTypeMismatch(
  options: ResolveObjectSlotMismatchOptions
): ObjectSlotMismatchResolution {
  return {
    error: createOlosError(
      "olos.content_type_mismatch",
      "object content type does not match slot",
      {
        contentType: options.mediaObject.contentType,
        objectKey: options.mediaObject.objectKey,
        slotContentType: options.slot.contentType,
        slotId: options.slot.slotId,
      }
    ),
    status: "content_type_mismatch",
  };
}

function objectTooLarge(
  options: ResolveObjectSlotMismatchOptions
): ObjectSlotMismatchResolution {
  return {
    error: createOlosError(
      "olos.object_too_large",
      "object exceeds slot limit",
      {
        maxBytes: options.slot.maxBytes,
        objectKey: options.mediaObject.objectKey,
        size: options.mediaObject.size,
        slotId: options.slot.slotId,
      }
    ),
    status: "object_too_large",
  };
}

function objectTooSmall(
  options: ResolveObjectSlotMismatchOptions
): ObjectSlotMismatchResolution {
  return {
    error: createOlosError(
      "olos.object_too_small",
      "mediaObject.size must be at least minBytes",
      {
        minBytes: options.slot.minBytes,
        objectKey: options.mediaObject.objectKey,
        size: options.mediaObject.size,
        slotId: options.slot.slotId,
      }
    ),
    status: "object_too_small",
  };
}

/**
 * Decide whether a repeated commit for the same slot is a benign retry or
 * a conflict. The duplicate is `idempotent` — the existing commit is
 * returned unchanged — only when every content field matches: delivery
 * URL, duration, epoch, etag, independent, media sequence number, object
 * key, part number, program date time, rendition ID, session ID, size,
 * and slot ID (`commitId` and `committedAt` may differ). Any other
 * difference is a `conflict` with an `olos.duplicate_commit_conflict`
 * error. Pure.
 */
export function resolveDuplicateCommit(
  options: ResolveDuplicateCommitOptions
): DuplicateCommitResolution {
  assertCommit(options.existingCommit);
  assertCommit(options.candidateCommit);

  if (commitsAreIdempotent(options.existingCommit, options.candidateCommit)) {
    return {
      commit: options.existingCommit,
      status: "idempotent",
    };
  }

  return {
    error: createOlosError(
      "olos.duplicate_commit_conflict",
      "duplicate commit conflicts with the existing commit",
      {
        candidateCommitId: options.candidateCommit.commitId,
        existingCommitId: options.existingCommit.commitId,
        slotId: options.existingCommit.slotId,
      }
    ),
    status: "conflict",
  };
}

function assertCommitPreconditions(options: CreateCommitOptions): void {
  const { mediaObject, slot } = options;

  assertObservedUploadSlot(slot);
  assertMatchingCommitObject(mediaObject, slot);
  assertCommitObjectSize(mediaObject, slot);
  assertCommitDeadline(options);
}

function assertObservedUploadSlot(
  slot: UploadSlot
): asserts slot is ObservedUploadSlot {
  if (!isObservedUploadSlot(slot)) {
    throw new Error("uploadSlot.state must be upload_observed");
  }
}

function assertMatchingCommitObject(
  mediaObject: MediaObject,
  slot: UploadSlot
): void {
  if (mediaObject.objectKey !== slot.objectKey) {
    throw new Error("mediaObject.objectKey must match uploadSlot.objectKey");
  }

  if (mediaObject.contentType !== slot.contentType) {
    throw new Error(
      "mediaObject.contentType must match uploadSlot.contentType"
    );
  }
}

function assertCommitObjectSize(
  mediaObject: MediaObject,
  slot: UploadSlot
): void {
  if (mediaObject.size > slot.maxBytes) {
    throw new Error("mediaObject.size must be less than or equal to maxBytes");
  }

  if (slot.minBytes !== undefined && mediaObject.size < slot.minBytes) {
    throw new Error(
      "mediaObject.size must be greater than or equal to minBytes"
    );
  }
}

function assertCommitDeadline(options: CreateCommitOptions): void {
  const { slot } = options;
  const committedAt = timestampMs(options.committedAt, "commit.committedAt");
  const expiresAt = timestampMs(slot.expiresAt, "uploadSlot.expiresAt");
  const lateToleranceMs = nonNegativeNumber(
    options.lateToleranceMs ?? 0,
    "lateToleranceMs"
  );

  if (committedAt > expiresAt + lateToleranceMs) {
    throw new Error("commit.committedAt must be before uploadSlot.expiresAt");
  }
}

function isObservedUploadSlot(slot: UploadSlot): slot is ObservedUploadSlot {
  return slot.state === "upload_observed";
}

function isLateSlot(slot: UploadSlot, cursor: Cursor): boolean {
  if (isBeforeCursorMediaSequence(slot, cursor)) {
    return true;
  }

  return isLateCursorPartPosition(slot, cursor);
}

function isBeforeCursorMediaSequence(
  slot: UploadSlot,
  cursor: Cursor
): boolean {
  return slot.mediaSequenceNumber < cursor.window.lastMediaSequenceNumber;
}

function isLateCursorPartPosition(slot: UploadSlot, cursor: Cursor): boolean {
  const lastPartNumber = cursor.window.lastPartNumber;

  if (
    slot.mediaSequenceNumber !== cursor.window.lastMediaSequenceNumber ||
    slot.partNumber === undefined ||
    lastPartNumber === undefined
  ) {
    return false;
  }

  return slot.partNumber <= lastPartNumber;
}

function commitsAreIdempotent(first: Commit, second: Commit): boolean {
  return COMMIT_IDEMPOTENCY_FIELDS.every(
    (field) => first[field] === second[field]
  );
}

const COMMIT_IDEMPOTENCY_FIELDS = [
  "deliveryUrl",
  "duration",
  "epoch",
  "etag",
  "independent",
  "mediaSequenceNumber",
  "objectKey",
  "partNumber",
  "programDateTime",
  "renditionId",
  "sessionId",
  "size",
  "slotId",
] as const satisfies readonly (keyof Commit)[];
