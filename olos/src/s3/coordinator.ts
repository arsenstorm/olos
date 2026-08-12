import {
  createCoordinatorManifestArtifacts,
  createHlsManifestArtifactResponse,
} from "../hls/manifest-artifacts";
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
import { createOlosError, type OlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import type {
  BlockedPublicationControl,
  CommitS3CoordinatorUploadOptions,
  CommitStoredS3CoordinatorUploadOptions,
  CompleteStoredS3CoordinatorUploadByObjectKeyOptions,
  CompleteStoredS3CoordinatorUploadOptions,
  IdempotentS3CoordinatorUploadCommit,
  IssueS3CoordinatorUploadGrantOptions,
  IssueStoredS3CoordinatorUploadGrantOptions,
  MissingStoredS3CoordinatorUploadCommit,
  MissingStoredS3CoordinatorUploadGrantIssue,
  ObjectCreatedS3UploadEvent,
  RejectedS3CoordinatorUploadCommit,
  RouteStoredS3CoordinatorUploadEventOptions,
  S3CoordinatorUploadGrantIssue,
  S3PresignGrantOptions,
  StoredS3CoordinatorManifest,
  StoredS3CoordinatorManifestOptions,
  StoredS3CoordinatorSlotResolution,
  StoredS3CoordinatorUploadCommit,
  StoredS3CoordinatorUploadCompletion,
  StoredS3CoordinatorUploadEventRoute,
  StoredS3CoordinatorUploadGrantIssue,
  StoredS3CoordinatorUploadRejection,
  UploadCompletedS3UploadEvent,
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

  const blocked = await rejectBlockedSlotIssue(
    sessionId,
    store,
    slotOptions.publicationControl
  );
  if (blocked !== undefined) {
    return blocked;
  }

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

/**
 * Complete an upload for a store-backed session by slot id. Identical to
 * {@link commitStoredS3CoordinatorUpload} except that when `objectKey` is
 * given, the slot's key must match it first — a mismatch is rejected with
 * `olos.key_mismatch` and an unknown slot with `olos.unknown_slot`.
 */
export async function completeStoredS3CoordinatorUpload(
  options: CompleteStoredS3CoordinatorUploadOptions
): Promise<StoredS3CoordinatorUploadCompletion> {
  const { objectKey, ...commitOptions } = options;

  if (objectKey === undefined) {
    return commitStoredS3CoordinatorUpload(commitOptions);
  }

  const snapshot = await options.store.load(options.sessionId);

  if (snapshot === undefined) {
    return missingStoredS3CoordinatorUploadCommit();
  }

  const slotResolution = resolveStoredS3CoordinatorSlotById(
    snapshot.state,
    options.slotId,
    objectKey
  );

  if (slotResolution.status !== "found") {
    return slotResolution;
  }

  return commitStoredS3CoordinatorUpload(commitOptions);
}

/**
 * Complete an upload for a store-backed session by object key alone —
 * the entry point for storage events that only know the uploaded key. Looks
 * up the slot whose `objectKey` matches, then completes it; rejects with
 * `olos.unknown_slot` when no slot claims the key.
 */
export async function completeStoredS3CoordinatorUploadByObjectKey(
  options: CompleteStoredS3CoordinatorUploadByObjectKeyOptions
): Promise<StoredS3CoordinatorUploadCompletion> {
  const snapshot = await options.store.load(options.sessionId);

  if (snapshot === undefined) {
    return missingStoredS3CoordinatorUploadCommit();
  }

  const slotResolution = resolveStoredS3CoordinatorSlotByObjectKey(
    snapshot.state,
    options.objectKey
  );

  if (slotResolution.status !== "found") {
    return slotResolution;
  }

  return completeStoredS3CoordinatorUpload({
    ...options,
    slotId: slotResolution.slot.slotId,
  });
}

function resolveStoredS3CoordinatorSlotById(
  state: CoordinatorPipelineState,
  slotId: OlosId,
  objectKey: string
): StoredS3CoordinatorSlotResolution {
  const slot = state.slots.find((entry) => entry.slotId === slotId);

  if (slot === undefined) {
    return unknownSlotS3CoordinatorUploadCommit(state, { slotId });
  }

  if (slot.objectKey !== objectKey) {
    return keyMismatchS3CoordinatorUploadCommit(state, {
      objectKey,
      slotId,
    });
  }

  return { slot, status: "found" };
}

function resolveStoredS3CoordinatorSlotByObjectKey(
  state: CoordinatorPipelineState,
  objectKey: string
): StoredS3CoordinatorSlotResolution {
  const slot = state.slots.find((entry) => entry.objectKey === objectKey);

  if (slot === undefined) {
    return unknownSlotS3CoordinatorUploadCommit(state, { objectKey });
  }

  return { slot, status: "found" };
}

function withAuditEvent(
  commit: RejectedS3CoordinatorUploadCommit,
  occurredAt: string
): StoredS3CoordinatorUploadRejection {
  const details = commit.error.error.details;

  if (
    commit.error.error.code !== "olos.object_too_large" ||
    details === undefined
  ) {
    return commit;
  }

  const fields: PartialObjectTooLargeAudit = {
    maxBytes: numberDetail(details.maxBytes),
    objectKey: stringDetail(details.objectKey),
    observedBytes: numberDetail(details.size),
    slotId: stringDetail(details.slotId),
  };

  // An audit event is only emitted when the rejection carried every detail
  // it needs; a partial one would report zeroes as if they were observed.
  if (!isCompleteObjectTooLargeAudit(fields)) {
    return commit;
  }

  return {
    ...commit,
    auditEvent: {
      error: commit.error,
      eventType: "upload.rejected",
      occurredAt,
      reason: "object_too_large",
      ...fields,
    },
  };
}

interface ObjectTooLargeAudit {
  maxBytes: number;
  objectKey: string;
  observedBytes: number;
  slotId: string;
}

type PartialObjectTooLargeAudit = {
  [Key in keyof ObjectTooLargeAudit]: ObjectTooLargeAudit[Key] | undefined;
};

function isCompleteObjectTooLargeAudit(
  fields: PartialObjectTooLargeAudit
): fields is ObjectTooLargeAudit {
  return Object.values(fields).every((value) => value !== undefined);
}

function numberDetail(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stringDetail(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function unknownSlotS3CoordinatorUploadCommit(
  state: CoordinatorPipelineState,
  details: Record<string, unknown>
): RejectedS3CoordinatorUploadCommit {
  return rejectedS3CoordinatorUploadCommit(
    state,
    createOlosError("olos.unknown_slot", "upload slot is unknown", details)
  );
}

function keyMismatchS3CoordinatorUploadCommit(
  state: CoordinatorPipelineState,
  details: Record<string, unknown>
): RejectedS3CoordinatorUploadCommit {
  return rejectedS3CoordinatorUploadCommit(
    state,
    createOlosError("olos.key_mismatch", "object key mismatches slot", details)
  );
}

function rejectedS3CoordinatorUploadCommit(
  state: CoordinatorPipelineState,
  error: OlosError
): RejectedS3CoordinatorUploadCommit {
  return {
    error,
    state,
    status: "rejected",
  };
}

/**
 * Route one normalized upload event to the matching completion path:
 * `object_created` events complete by object key (subject to
 * publication-control checks for provider events), `upload_completed` hints
 * complete by slot id, and `invalid_event` normalizations pass through
 * unchanged.
 */
export async function routeStoredS3CoordinatorUploadEvent(
  options: RouteStoredS3CoordinatorUploadEventOptions
): Promise<StoredS3CoordinatorUploadEventRoute> {
  const { event } = options;

  if (event.status === "invalid_event") {
    return event;
  }

  if (event.status === "object_created") {
    return await routeStoredS3CoordinatorObjectCreatedEvent(options, event);
  }

  return await routeStoredS3CoordinatorUploadCompletedEvent(options, event);
}

async function routeStoredS3CoordinatorObjectCreatedEvent(
  options: RouteStoredS3CoordinatorUploadEventOptions,
  event: ObjectCreatedS3UploadEvent
): Promise<StoredS3CoordinatorUploadCommit> {
  const publication = await resolveStoredProviderEventPublication(options);

  if (publication !== undefined) {
    return publication;
  }

  return await completeStoredS3CoordinatorUploadByObjectKey({
    bucket: options.bucket,
    client: options.client,
    commitId: event.event.eventId,
    committedAt: event.event.object.observedAt,
    commitPolicy: options.commitPolicy,
    independent: options.independent,
    lateToleranceMs: options.lateToleranceMs,
    manifest: options.manifest,
    maxAttempts: options.maxAttempts,
    maxSegments: options.maxSegments,
    objectKey: event.event.object.objectKey,
    publicationControl: options.publicationControl,
    programDateTime: options.programDateTime,
    providerId: event.event.object.providerId,
    sessionId: options.sessionId,
    store: options.store,
    versionId: options.versionId,
  });
}

async function routeStoredS3CoordinatorUploadCompletedEvent(
  options: RouteStoredS3CoordinatorUploadEventOptions,
  event: UploadCompletedS3UploadEvent
): Promise<StoredS3CoordinatorUploadCompletion> {
  return await completeStoredS3CoordinatorUpload({
    bucket: options.bucket,
    client: options.client,
    commitId: event.hint.eventId,
    committedAt: event.hint.eventTime,
    commitPolicy: options.commitPolicy,
    independent: options.independent,
    lateToleranceMs: options.lateToleranceMs,
    manifest: options.manifest,
    maxAttempts: options.maxAttempts,
    maxSegments: options.maxSegments,
    objectKey: event.hint.objectKey,
    publicationControl: options.publicationControl,
    programDateTime: options.programDateTime,
    providerId: options.providerId,
    sessionId: options.sessionId,
    slotId: event.hint.slotId,
    store: options.store,
    versionId: options.versionId,
  });
}

async function resolveStoredProviderEventPublication(
  options: RouteStoredS3CoordinatorUploadEventOptions
): Promise<StoredS3CoordinatorUploadCommit | undefined> {
  const publication = resolvePublicationControl({
    operation: "process_provider_event",
    policy: options.publicationControl,
  });

  if (publication.status === "allowed") {
    return;
  }

  const snapshot = await options.store.load(options.sessionId);

  if (snapshot === undefined) {
    return missingStoredS3CoordinatorUploadCommit();
  }

  return {
    error: publication.error,
    state: snapshot.state,
    status: "rejected",
  };
}

function withManifest<T extends { state: CoordinatorPipelineState }>(
  result: T,
  manifest: StoredS3CoordinatorManifestOptions | undefined
): T & { manifest?: StoredS3CoordinatorManifest } {
  if (manifest === undefined) {
    return result;
  }

  const { response, ...manifestOptions } = manifest;
  const artifacts = createCoordinatorManifestArtifacts({
    ...manifestOptions,
    state: result.state,
  });

  return {
    ...result,
    manifest: {
      ...(artifacts.cursor === undefined ? {} : { cursor: artifacts.cursor }),
      artifacts: artifacts.artifacts.map((artifact) => ({
        ...artifact,
        response: createHlsManifestArtifactResponse(artifact, response),
      })),
    },
  };
}

function missingStoredS3CoordinatorUploadCommit(): MissingStoredS3CoordinatorUploadCommit {
  return { status: "not_found" };
}

function missingStoredS3CoordinatorUploadGrantIssue(): MissingStoredS3CoordinatorUploadGrantIssue {
  return { status: "not_found" };
}
