import { commitCoordinatorUpload } from "../protocol/coordinator-commit";
import { issueCoordinatorSlot } from "../protocol/coordinator-slot";
import type {
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineState,
  CoordinatorPipelineStore,
  CoordinatorSlotIssue,
  CoordinatorUploadCommit,
} from "../protocol/coordinator-types";
import {
  runStoredCoordinatorMutationWithAdaptersAndResponse,
  type SavedCoordinatorPipelineResult,
  type StoredMutationDecision,
} from "../protocol/mutate-coordinator-store";
import {
  type PublicationControlPolicy,
  type PublicationControlResolution,
  resolvePublicationControl,
} from "../state/publication-control";
import type { OlosId } from "../types/ids";
import type { UploadSlot } from "../types/upload-slot";
import {
  missingStoredS3CoordinatorUploadCommit,
  missingStoredS3CoordinatorUploadGrantIssue,
  unknownSlotS3CoordinatorUploadCommit,
  withAuditEvent,
  withManifest,
} from "./coordinator-event";
import type {
  BlockedPublicationControl,
  CommitS3CoordinatorUploadOptions,
  CommitStoredS3CoordinatorUploadOptions,
  IdempotentS3CoordinatorUploadCommit,
  IssueS3CoordinatorUploadGrantOptions,
  IssueStoredS3CoordinatorUploadGrantOptions,
  RejectedS3CoordinatorUploadCommit,
  S3CoordinatorUploadGrantIssue,
  S3PresignGrantOptions,
  StoredS3CoordinatorManifestOptions,
  StoredS3CoordinatorUploadCommit,
  StoredS3CoordinatorUploadGrantIssue,
} from "./coordinator-types";
import { observeS3Object } from "./object-observation";
import { createPresignedS3UploadGrant } from "./upload-grant";
/**
 * Issue an upload slot on an in-memory coordinator state and create a
 * presigned S3 PUT grant for it. Pure with respect to storage — the caller
 * owns persisting the returned state; use
 * {@link issueStoredS3CoordinatorUploadGrant} for store-backed sessions. The
 * presigned URL pins content type and slot metadata headers and sets
 * `If-None-Match: *` so the upload cannot overwrite an existing object.
 */
export async function issueS3CoordinatorUploadGrant(
  options: IssueS3CoordinatorUploadGrantOptions
): Promise<S3CoordinatorUploadGrantIssue> {
  const { additionalHeaders, bucket, client, expiresInSeconds, now, ...slot } =
    options;
  const issued = issueCoordinatorSlot(slot);
  const grant = await createPresignedS3UploadGrant({
    additionalHeaders,
    bucket,
    client,
    expiresInSeconds,
    now,
    slot: issued.slot,
  });

  return {
    grant,
    slot: issued.slot,
    state: issued.state,
  };
}

/**
 * Issue an upload slot for a store-backed session and presign an S3 PUT
 * grant for it. Loads the session snapshot, issues the slot, and saves the
 * new state with optimistic concurrency, retrying up to `maxAttempts` before
 * reporting `conflict`. Publication control can reject the issue; a missing
 * session yields `not_found`. The grant is presigned only after the slot is
 * durably saved.
 */
export async function issueStoredS3CoordinatorUploadGrant(
  options: IssueStoredS3CoordinatorUploadGrantOptions
): Promise<StoredS3CoordinatorUploadGrantIssue> {
  const blocked = await rejectBlockedSlotIssue(
    options.sessionId,
    options.store,
    options.publicationControl
  );

  return blocked ?? (await runSlotIssueMutation(options));
}

/** Issue the slot under optimistic concurrency, presigning once it saves. */
function runSlotIssueMutation(
  options: IssueStoredS3CoordinatorUploadGrantOptions
): Promise<StoredS3CoordinatorUploadGrantIssue> {
  const {
    additionalHeaders,
    bucket,
    client,
    expiresInSeconds,
    maxAttempts,
    now,
    sessionId,
    store,
    ...slotOptions
  } = options;

  return runStoredCoordinatorMutationWithAdaptersAndResponse<
    CoordinatorSlotIssue,
    CoordinatorSlotIssue,
    StoredS3CoordinatorUploadGrantIssue
  >({
    maxAttempts,
    mutate: async (state) =>
      issueCoordinatorSlot({
        ...slotOptions,
        state,
      }),
    decide: (issue) => ({
      attempt: issue,
      status: "save",
      state: issue.state,
    }),
    sessionId,
    store,
    onMissing: () => missingStoredS3CoordinatorUploadGrantIssue(),
    mapSaved: (saved, attempt) =>
      presignSavedSlot(
        { additionalHeaders, bucket, client, expiresInSeconds, now },
        saved,
        attempt
      ),
    onConflictOrExhausted: (snapshot) => conflict(snapshot),
  });
}

/** A commit blocked by publication control, or `undefined` to proceed. */
function rejectBlockedCommit(
  state: CoordinatorPipelineState,
  publicationControl: PublicationControlPolicy | undefined
): CoordinatorUploadCommit | undefined {
  const publication = resolvePublicationControl({
    operation: "commit_upload",
    policy: publicationControl,
  });
  if (!isBlockedPublicationControl(publication)) {
    return;
  }

  return { error: publication.error, state, status: "rejected" };
}

/**
 * Publication control is resolved before the mutation so a blocked issue
 * never takes an optimistic-concurrency attempt. The snapshot is loaded only
 * to report the state alongside the rejection.
 */
async function rejectBlockedSlotIssue(
  sessionId: OlosId,
  store: CoordinatorPipelineStore,
  publicationControl: PublicationControlPolicy | undefined
): Promise<StoredS3CoordinatorUploadGrantIssue | undefined> {
  const publication = resolvePublicationControl({
    operation: "issue_slot",
    policy: publicationControl,
  });
  if (!isBlockedPublicationControl(publication)) {
    return;
  }

  const snapshot = await store.load(sessionId);
  if (snapshot === undefined) {
    return missingStoredS3CoordinatorUploadGrantIssue();
  }

  return {
    error: publication.error,
    state: snapshot.state,
    status: "rejected",
  };
}

/** Presign the PUT only once the slot is durably saved. */
async function presignSavedSlot(
  presign: S3PresignGrantOptions,
  saved: SavedCoordinatorPipelineResult,
  attempt: CoordinatorSlotIssue
): Promise<StoredS3CoordinatorUploadGrantIssue> {
  const grant = await createPresignedS3UploadGrant({
    ...presign,
    slot: attempt.slot,
  });

  return {
    etag: saved.etag,
    grant,
    slot: attempt.slot,
    state: saved.state,
    status: "saved",
  };
}

/**
 * Commit an uploaded slot against an in-memory coordinator state. Verifies
 * the object exists via S3 `HeadObject` (a network side effect), then applies
 * the protocol commit. Rejects with `olos.unknown_slot` when the slot id is
 * not in the state, or with a publication-control error when commits are
 * blocked. The caller owns persisting the returned state; use
 * {@link commitStoredS3CoordinatorUpload} for store-backed sessions.
 */
export async function commitS3CoordinatorUpload(
  options: CommitS3CoordinatorUploadOptions
): Promise<CoordinatorUploadCommit> {
  const blocked = rejectBlockedCommit(
    options.state,
    options.publicationControl
  );
  if (blocked !== undefined) {
    return blocked;
  }

  const slot = options.state.slots.find(
    (entry) => entry.slotId === options.slotId
  );

  if (slot === undefined) {
    return unknownSlotS3CoordinatorUploadCommit(options.state, {
      slotId: options.slotId,
    });
  }

  return await commitObservedObject(options, slot);
}

/**
 * `HeadObject` is the network side effect this wrapper adds over the pure
 * protocol commit: the object must be observable before it is committed.
 */
async function commitObservedObject(
  options: CommitS3CoordinatorUploadOptions,
  slot: UploadSlot
): Promise<CoordinatorUploadCommit> {
  const object = await observeS3Object({
    bucket: options.bucket,
    client: options.client,
    objectKey: slot.objectKey,
    observedAt: options.committedAt,
    providerId: options.providerId,
    versionId: options.versionId,
  });

  return commitCoordinatorUpload({
    commitId: options.commitId,
    committedAt: options.committedAt,
    commitPolicy: options.commitPolicy,
    independent: options.independent,
    lateToleranceMs: options.lateToleranceMs,
    maxSegments: options.maxSegments,
    object,
    publicationControl: options.publicationControl,
    programDateTime: options.programDateTime,
    slotId: options.slotId,
    state: options.state,
  });
}

/**
 * Commit an uploaded slot for a store-backed session. Observes the object
 * via S3 `HeadObject`, applies the commit, and saves the new state with
 * optimistic concurrency, retrying up to `maxAttempts` before reporting
 * `conflict`. Replaying an already-applied `commitId` returns `idempotent`
 * without another save. Oversized-object rejections carry an `auditEvent`;
 * when `manifest` options are set, successful results include rendered
 * manifest artifacts.
 */
export async function commitStoredS3CoordinatorUpload(
  options: CommitStoredS3CoordinatorUploadOptions
): Promise<StoredS3CoordinatorUploadCommit> {
  const { manifest, maxAttempts, sessionId, store, ...commitOptions } = options;
  return await runStoredCoordinatorMutationWithAdaptersAndResponse<
    CoordinatorUploadCommit,
    Exclude<CoordinatorUploadCommit, RejectedS3CoordinatorUploadCommit>,
    StoredS3CoordinatorUploadCommit
  >({
    maxAttempts,
    mutate: async (state) =>
      await commitS3CoordinatorUpload({
        ...commitOptions,
        state,
      }),
    sessionId,
    store,
    decide: (commit, snapshot) =>
      decideStoredCommit(commit, snapshot, commitOptions.committedAt, manifest),
    onMissing: () => missingStoredS3CoordinatorUploadCommit(),
    mapSaved: (saved, commit) =>
      withManifest(
        {
          ...commit,
          etag: saved.etag,
          ...(saved.state.cursor === undefined
            ? {}
            : { cursor: saved.state.cursor }),
          state: saved.state,
        },
        manifest
      ),
    onConflictOrExhausted: (snapshot) => conflict(snapshot),
  });
}

/**
 * Both terminal outcomes settle without a save: a rejection carries its audit
 * event, and an already-applied `commitId` replays the stored result. Only a
 * fresh commit goes on to be persisted.
 */
function decideStoredCommit(
  commit: CoordinatorUploadCommit,
  snapshot: CoordinatorPipelineSnapshot,
  committedAt: string,
  manifest: StoredS3CoordinatorManifestOptions | undefined
): StoredMutationDecision<
  Exclude<CoordinatorUploadCommit, RejectedS3CoordinatorUploadCommit>,
  StoredS3CoordinatorUploadCommit
> {
  if (isRejectedS3CoordinatorUploadCommit(commit)) {
    return {
      result: withAuditEvent(commit, committedAt),
      status: "terminal",
    };
  }

  if (isIdempotentS3CoordinatorUploadCommit(commit)) {
    return {
      result: withManifest({ ...commit, etag: snapshot.etag }, manifest),
      status: "terminal",
    };
  }

  return { attempt: commit, state: commit.state, status: "save" };
}

function conflict(current?: CoordinatorPipelineSnapshot): {
  current?: CoordinatorPipelineSnapshot;
  status: "conflict";
} {
  return current === undefined
    ? { status: "conflict" }
    : { current, status: "conflict" };
}

function isIdempotentS3CoordinatorUploadCommit(
  result: CoordinatorUploadCommit
): result is IdempotentS3CoordinatorUploadCommit {
  return result.status === "idempotent";
}

function isRejectedS3CoordinatorUploadCommit(
  result: CoordinatorUploadCommit
): result is RejectedS3CoordinatorUploadCommit {
  return result.status === "rejected";
}

function isBlockedPublicationControl(
  result: PublicationControlResolution
): result is BlockedPublicationControl {
  return result.status === "blocked";
}
