import type { S3Client } from "@aws-sdk/client-s3";
import {
  type CoordinatorManifestArtifacts,
  type CreateCoordinatorManifestArtifactsOptions,
  type CreateHlsManifestArtifactResponseOptions,
  createCoordinatorManifestArtifacts,
  createHlsManifestArtifactResponse,
  type HlsManifestArtifact,
  type HlsManifestArtifactResponse,
} from "../hls/manifest-artifacts";
import { commitCoordinatorUpload } from "../protocol/coordinator-commit";
import { issueCoordinatorSlot } from "../protocol/coordinator-slot";
import type {
  CoordinatorCommitPolicy,
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineState,
  CoordinatorPipelineStore,
  CoordinatorSlotIssue,
  CoordinatorUploadCommit,
  IssueCoordinatorSlotOptions,
} from "../protocol/coordinator-types";
import { runStoredCoordinatorMutationWithAdaptersAndResponse } from "../protocol/mutate-coordinator-store";
import type { UploadEventNormalization } from "../state/observed-upload";
import {
  type PublicationControlPolicy,
  type PublicationControlResolution,
  resolvePublicationControl,
} from "../state/publication-control";
import type { OlosError } from "../types/errors";
import { createOlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import { observeS3Object, type S3HeadObjectClient } from "./object-observation";
import { createPresignedS3UploadGrant } from "./upload-grant";

/** Options for {@link commitS3CoordinatorUpload}. */
export interface CommitS3CoordinatorUploadOptions {
  bucket: string;
  client: S3HeadObjectClient;
  commitId: OlosId;
  commitPolicy?: CoordinatorCommitPolicy;
  committedAt: string;
  independent?: boolean;
  lateToleranceMs?: number;
  maxSegments?: number;
  programDateTime?: string;
  providerId: string;
  publicationControl?: PublicationControlPolicy;
  slotId: OlosId;
  state: CoordinatorPipelineState;
  versionId?: string;
}

/** Options for {@link commitStoredS3CoordinatorUpload}. */
export interface CommitStoredS3CoordinatorUploadOptions
  extends Omit<CommitS3CoordinatorUploadOptions, "state"> {
  /** When set, manifest artifacts are rendered into the commit result. */
  manifest?: StoredS3CoordinatorManifestOptions;
  /** Optimistic-concurrency retries before giving up as a conflict. */
  maxAttempts?: number;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

/** Options for {@link completeStoredS3CoordinatorUpload}. */
export interface CompleteStoredS3CoordinatorUploadOptions
  extends CommitStoredS3CoordinatorUploadOptions {
  /**
   * When set, the slot's object key must match or the completion is
   * rejected with `olos.key_mismatch`.
   */
  objectKey?: string;
}

/** Options for {@link completeStoredS3CoordinatorUploadByObjectKey}. */
export interface CompleteStoredS3CoordinatorUploadByObjectKeyOptions
  extends Omit<
    CompleteStoredS3CoordinatorUploadOptions,
    "objectKey" | "slotId"
  > {
  /** Object key used to look up the slot to complete. */
  objectKey: string;
}

/** Options for {@link routeStoredS3CoordinatorUploadEvent}. */
export interface RouteStoredS3CoordinatorUploadEventOptions {
  bucket: string;
  client: S3HeadObjectClient;
  commitPolicy?: CoordinatorCommitPolicy;
  event: UploadEventNormalization;
  independent?: boolean;
  lateToleranceMs?: number;
  manifest?: StoredS3CoordinatorManifestOptions;
  maxAttempts?: number;
  maxSegments?: number;
  programDateTime?: string;
  providerId: string;
  publicationControl?: PublicationControlPolicy;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
  versionId?: string;
}

/**
 * Manifest rendering options attached to a stored commit. When present, the
 * commit result includes freshly rendered HLS manifest artifacts for the
 * post-commit state.
 */
export interface StoredS3CoordinatorManifestOptions
  extends Omit<CreateCoordinatorManifestArtifactsOptions, "state"> {
  /** HTTP response rendering options (headers, status) per artifact. */
  response?: CreateHlsManifestArtifactResponseOptions;
}

/** HLS manifest artifact paired with its ready-to-serve HTTP response. */
export interface StoredS3CoordinatorManifestArtifact
  extends HlsManifestArtifact {
  response: HlsManifestArtifactResponse;
}

/** Manifest artifacts rendered from the state a commit produced. */
export interface StoredS3CoordinatorManifest {
  artifacts: readonly StoredS3CoordinatorManifestArtifact[];
  cursor?: CoordinatorManifestArtifacts["cursor"];
}

/**
 * Audit record attached to a rejected commit when an uploaded object
 * exceeded the slot's size limit (`olos.object_too_large`), so callers can
 * log or forward the violation.
 */
export interface StoredS3CoordinatorUploadAuditEvent {
  error: OlosError;
  eventType: "upload.rejected";
  /** Slot's configured maximum object size, in bytes. */
  maxBytes: number;
  objectKey: string;
  /** Size reported by S3 for the offending object, in bytes. */
  observedBytes: number;
  /** ISO 8601 timestamp of the rejected completion attempt. */
  occurredAt: string;
  reason: "object_too_large";
  slotId: OlosId;
}

type StoredS3CoordinatorUploadRejection = Extract<
  CoordinatorUploadCommit,
  { status: "rejected" }
> & {
  auditEvent?: StoredS3CoordinatorUploadAuditEvent;
};

type RejectedS3CoordinatorUploadCommit = Extract<
  CoordinatorUploadCommit,
  { status: "rejected" }
>;

type BlockedPublicationControl = Extract<
  PublicationControlResolution,
  { status: "blocked" }
>;

type ObjectCreatedS3UploadEvent = Extract<
  UploadEventNormalization,
  { status: "object_created" }
>;

type UploadCompletedS3UploadEvent = Extract<
  UploadEventNormalization,
  { status: "upload_completed" }
>;

type MissingStoredS3CoordinatorUploadCommit = Extract<
  StoredS3CoordinatorUploadCommit,
  { status: "not_found" }
>;

type StoredS3CoordinatorSlotResolution =
  | {
      slot: UploadSlot;
      status: "found";
    }
  | MissingStoredS3CoordinatorUploadCommit
  | RejectedS3CoordinatorUploadCommit;

type MissingStoredS3CoordinatorUploadGrantIssue = Extract<
  StoredS3CoordinatorUploadGrantIssue,
  { status: "not_found" }
>;

/**
 * Result of committing an upload against a stored session. `committed` and
 * `idempotent` carry the saved snapshot's etag (and manifest artifacts when
 * requested); `rejected` carries the `olos.*` error (plus an audit event for
 * oversized objects); `conflict` means concurrent writers exhausted the
 * retry budget; `not_found` means the session does not exist.
 */
export type StoredS3CoordinatorUploadCommit =
  | (Extract<
      CoordinatorUploadCommit,
      { status: "committed" | "idempotent" }
    > & {
      etag: string;
      manifest?: StoredS3CoordinatorManifest;
    })
  | StoredS3CoordinatorUploadRejection
  | {
      current?: CoordinatorPipelineSnapshot;
      status: "conflict";
    }
  | {
      status: "not_found";
    };

/** Result of a completion; identical to a stored commit result. */
export type StoredS3CoordinatorUploadCompletion =
  StoredS3CoordinatorUploadCommit;

type IdempotentS3CoordinatorUploadCommit = Extract<
  CoordinatorUploadCommit,
  { status: "committed" | "idempotent" }
> & { status: "idempotent" };

/**
 * Result of routing a normalized S3 upload event: a completion result for
 * events that reached the commit path, or `invalid_event` when the event
 * failed normalization.
 */
export type StoredS3CoordinatorUploadEventRoute =
  | StoredS3CoordinatorUploadCompletion
  | {
      error: OlosError;
      status: "invalid_event";
    };

/** Options for {@link issueS3CoordinatorUploadGrant}. */
export interface IssueS3CoordinatorUploadGrantOptions
  extends IssueCoordinatorSlotOptions {
  /**
   * Extra headers the uploader must send; must not override the
   * `x-amz-meta-olos-*` slot metadata headers.
   */
  additionalHeaders?: Record<string, string>;
  bucket: string;
  client: S3Client;
  /**
   * Presigned URL lifetime in seconds. The grant must not outlive the
   * slot's own `expiresAt`.
   */
  expiresInSeconds: number;
  /** Timestamp the grant expiry is computed from (default: current time). */
  now?: Date | string;
}

/** Issued slot, its presigned grant, and the updated in-memory state. */
export interface S3CoordinatorUploadGrantIssue {
  grant: UploadGrant;
  slot: UploadSlot;
  state: CoordinatorPipelineState;
}

/** Options for {@link issueStoredS3CoordinatorUploadGrant}. */
export interface IssueStoredS3CoordinatorUploadGrantOptions
  extends Omit<IssueS3CoordinatorUploadGrantOptions, "state"> {
  /** Optimistic-concurrency retries before giving up as a conflict. */
  maxAttempts?: number;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

/**
 * Result of issuing a grant against a stored session: `saved` carries the
 * slot, grant, and saved snapshot's etag; `rejected` carries the `olos.*`
 * error (for example when publication control blocks slot issue);
 * `conflict` means concurrent writers exhausted the retry budget;
 * `not_found` means the session does not exist.
 */
export type StoredS3CoordinatorUploadGrantIssue =
  | {
      etag: string;
      grant: UploadGrant;
      slot: UploadSlot;
      state: CoordinatorPipelineState;
      status: "saved";
    }
  | {
      error: OlosError;
      state: CoordinatorPipelineState;
      status: "rejected";
    }
  | {
      current?: CoordinatorPipelineSnapshot;
      status: "conflict";
    }
  | {
      status: "not_found";
    };

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
  const publication = resolvePublicationControl({
    operation: "issue_slot",
    policy: slotOptions.publicationControl,
  });
  if (isBlockedPublicationControl(publication)) {
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
    mapSaved: async (saved, attempt) => {
      const grant = await createPresignedS3UploadGrant({
        additionalHeaders,
        bucket,
        client,
        expiresInSeconds,
        now,
        slot: attempt.slot,
      });

      return {
        etag: saved.etag,
        grant,
        slot: attempt.slot,
        state: saved.state,
        status: "saved",
      };
    },
    onConflictOrExhausted: (snapshot) => conflict(snapshot),
  });
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
  const publication = resolvePublicationControl({
    operation: "commit_upload",
    policy: options.publicationControl,
  });

  if (isBlockedPublicationControl(publication)) {
    return {
      error: publication.error,
      state: options.state,
      status: "rejected",
    };
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
    decide: (commit, snapshot) => {
      if (isRejectedS3CoordinatorUploadCommit(commit)) {
        return {
          status: "terminal",
          result: withAuditEvent(commit, commitOptions.committedAt),
        };
      }

      if (isIdempotentS3CoordinatorUploadCommit(commit)) {
        return {
          status: "terminal",
          result: withManifest(
            {
              ...commit,
              etag: snapshot.etag,
            },
            manifest
          ),
        };
      }

      return { attempt: commit, status: "save", state: commit.state };
    },
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
