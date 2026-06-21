import type { S3Client } from "@aws-sdk/client-s3";
import {
  type CreateHlsManifestArtifactResponseOptions,
  createHlsManifestArtifactResponse,
  type HlsManifestArtifact,
  type HlsManifestArtifactResponse,
} from "../hls/manifest-artifacts";
import {
  type CoordinatorCommitPolicy,
  type CoordinatorManifestArtifacts,
  type CoordinatorPipelineSnapshot,
  type CoordinatorPipelineStore,
  type CoordinatorUploadCommit,
  type CreateCoordinatorManifestArtifactsOptions,
  commitCoordinatorUpload,
  createCoordinatorManifestArtifacts,
  issueCoordinatorSlot,
} from "../protocol";
import type {
  CoordinatorPipelineState,
  IssueCoordinatorSlotOptions,
} from "../protocol/coordinator";
import {
  positiveMutationAttempts,
  runStoredCoordinatorMutationWithAdaptersAndConflict,
} from "../protocol/mutate-coordinator-store";
import type { UploadEventNormalization } from "../state/observed-upload";
import {
  type PublicationControlPolicy,
  type PublicationControlResolution,
  resolvePublicationControl,
} from "../state/publication-control";
import type { OlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import { observeS3Object, type S3HeadObjectClient } from "./object-observation";
import { createPresignedS3UploadGrant } from "./upload-grant";

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

export interface CommitStoredS3CoordinatorUploadOptions
  extends Omit<CommitS3CoordinatorUploadOptions, "state"> {
  manifest?: StoredS3CoordinatorManifestOptions;
  maxAttempts?: number;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

export interface CompleteStoredS3CoordinatorUploadOptions
  extends CommitStoredS3CoordinatorUploadOptions {
  objectKey?: string;
}

export interface CompleteStoredS3CoordinatorUploadByObjectKeyOptions
  extends Omit<
    CompleteStoredS3CoordinatorUploadOptions,
    "objectKey" | "slotId"
  > {
  objectKey: string;
}

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

export interface StoredS3CoordinatorManifestOptions
  extends Omit<CreateCoordinatorManifestArtifactsOptions, "state"> {
  response?: CreateHlsManifestArtifactResponseOptions;
}

export interface StoredS3CoordinatorManifestArtifact
  extends HlsManifestArtifact {
  response: HlsManifestArtifactResponse;
}

export interface StoredS3CoordinatorManifest {
  artifacts: readonly StoredS3CoordinatorManifestArtifact[];
  cursor?: CoordinatorManifestArtifacts["cursor"];
}

export interface StoredS3CoordinatorUploadAuditEvent {
  error: OlosError;
  eventType: "upload.rejected";
  maxBytes: number;
  objectKey: string;
  observedBytes: number;
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

type MissingStoredS3CoordinatorUploadCommit = Extract<
  StoredS3CoordinatorUploadCommit,
  { status: "not_found" }
>;

type MissingStoredS3CoordinatorUploadGrantIssue = Extract<
  StoredS3CoordinatorUploadGrantIssue,
  { status: "not_found" }
>;

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

export type StoredS3CoordinatorUploadCompletion =
  StoredS3CoordinatorUploadCommit;

type IdempotentS3CoordinatorUploadCommit = Extract<
  CoordinatorUploadCommit,
  { status: "committed" | "idempotent" }
> & { status: "idempotent" };

export type StoredS3CoordinatorUploadEventRoute =
  | StoredS3CoordinatorUploadCompletion
  | {
      error: OlosError;
      status: "invalid_event";
    };

export interface IssueS3CoordinatorUploadGrantOptions
  extends IssueCoordinatorSlotOptions {
  additionalHeaders?: Record<string, string>;
  bucket: string;
  client: S3Client;
  expiresInSeconds: number;
  now?: Date | string;
}

export interface S3CoordinatorUploadGrantIssue {
  grant: UploadGrant;
  slot: UploadSlot;
  state: CoordinatorPipelineState;
}

export interface IssueStoredS3CoordinatorUploadGrantOptions
  extends Omit<IssueS3CoordinatorUploadGrantOptions, "state"> {
  maxAttempts?: number;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

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
  const attempts = positiveMutationAttempts(maxAttempts);

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

  return runStoredCoordinatorMutationWithAdaptersAndConflict({
    attempts,
    mutate: async (state) =>
      issueCoordinatorSlot({
        ...slotOptions,
        state,
      }),
    decide: (issue) => ({
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
    return {
      error: coordinatorError("olos.unknown_slot", "upload slot is unknown", {
        slotId: options.slotId,
      }),
      state: options.state,
      status: "rejected",
    };
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

export async function commitStoredS3CoordinatorUpload(
  options: CommitStoredS3CoordinatorUploadOptions
): Promise<StoredS3CoordinatorUploadCommit> {
  const { manifest, maxAttempts, sessionId, store, ...commitOptions } = options;
  const attempts = positiveMutationAttempts(maxAttempts);

  return await runStoredCoordinatorMutationWithAdaptersAndConflict({
    attempts,
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

      return { status: "save", state: commit.state };
    },
    onMissing: () => missingStoredS3CoordinatorUploadCommit(),
    mapTerminal: (commit) => commit,
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

  const slot = snapshot.state.slots.find(
    (entry) => entry.slotId === options.slotId
  );

  if (slot === undefined) {
    return {
      error: coordinatorError("olos.unknown_slot", "upload slot is unknown", {
        slotId: options.slotId,
      }),
      state: snapshot.state,
      status: "rejected",
    };
  }

  if (slot.objectKey !== objectKey) {
    return {
      error: coordinatorError(
        "olos.key_mismatch",
        "object key mismatches slot",
        {
          objectKey,
          slotId: options.slotId,
        }
      ),
      state: snapshot.state,
      status: "rejected",
    };
  }

  return commitStoredS3CoordinatorUpload(commitOptions);
}

export async function completeStoredS3CoordinatorUploadByObjectKey(
  options: CompleteStoredS3CoordinatorUploadByObjectKeyOptions
): Promise<StoredS3CoordinatorUploadCompletion> {
  const snapshot = await options.store.load(options.sessionId);

  if (snapshot === undefined) {
    return missingStoredS3CoordinatorUploadCommit();
  }

  const slot = snapshot.state.slots.find(
    (entry) => entry.objectKey === options.objectKey
  );

  if (slot === undefined) {
    return {
      error: coordinatorError("olos.unknown_slot", "upload slot is unknown", {
        objectKey: options.objectKey,
      }),
      state: snapshot.state,
      status: "rejected",
    };
  }

  return completeStoredS3CoordinatorUpload({
    ...options,
    slotId: slot.slotId,
  });
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

  const maxBytes = numberDetail(details.maxBytes);
  const observedBytes = numberDetail(details.size);
  const objectKey = stringDetail(details.objectKey);
  const slotId = stringDetail(details.slotId);

  if (
    maxBytes === undefined ||
    observedBytes === undefined ||
    objectKey === undefined ||
    slotId === undefined
  ) {
    return commit;
  }

  return {
    ...commit,
    auditEvent: {
      error: commit.error,
      eventType: "upload.rejected",
      maxBytes,
      objectKey,
      observedBytes,
      occurredAt,
      reason: "object_too_large",
      slotId,
    },
  };
}

function numberDetail(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stringDetail(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export async function routeStoredS3CoordinatorUploadEvent(
  options: RouteStoredS3CoordinatorUploadEventOptions
): Promise<StoredS3CoordinatorUploadEventRoute> {
  if (options.event.status === "invalid_event") {
    return options.event;
  }

  if (options.event.status === "object_created") {
    const publication = await resolveStoredProviderEventPublication(options);

    if (publication !== undefined) {
      return publication;
    }

    return await completeStoredS3CoordinatorUploadByObjectKey({
      bucket: options.bucket,
      client: options.client,
      commitId: options.event.event.eventId,
      committedAt: options.event.event.object.observedAt,
      commitPolicy: options.commitPolicy,
      independent: options.independent,
      lateToleranceMs: options.lateToleranceMs,
      manifest: options.manifest,
      maxAttempts: options.maxAttempts,
      maxSegments: options.maxSegments,
      objectKey: options.event.event.object.objectKey,
      publicationControl: options.publicationControl,
      programDateTime: options.programDateTime,
      providerId: options.event.event.object.providerId,
      sessionId: options.sessionId,
      store: options.store,
      versionId: options.versionId,
    });
  }

  return await completeStoredS3CoordinatorUpload({
    bucket: options.bucket,
    client: options.client,
    commitId: options.event.hint.eventId,
    committedAt: options.event.hint.eventTime,
    commitPolicy: options.commitPolicy,
    independent: options.independent,
    lateToleranceMs: options.lateToleranceMs,
    manifest: options.manifest,
    maxAttempts: options.maxAttempts,
    maxSegments: options.maxSegments,
    objectKey: options.event.hint.objectKey,
    publicationControl: options.publicationControl,
    programDateTime: options.programDateTime,
    providerId: options.providerId,
    sessionId: options.sessionId,
    slotId: options.event.hint.slotId,
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

function coordinatorError(
  code: OlosError["error"]["code"],
  message: string,
  details?: Record<string, unknown>
): OlosError {
  return {
    error: {
      code,
      ...(details === undefined ? {} : { details }),
      message,
    },
  };
}
