import { createCoordinatorManifestArtifacts } from "../hls/manifest-artifacts";
import { createHlsManifestArtifactResponse } from "../hls/manifest-response";
import type { CoordinatorPipelineState } from "../protocol/coordinator-types";
import { resolvePublicationControl } from "../state/publication-control";
import { createOlosError, type OlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import { commitStoredS3CoordinatorUpload } from "./coordinator-grant";
import type {
  CompleteStoredS3CoordinatorUploadByObjectKeyOptions,
  CompleteStoredS3CoordinatorUploadOptions,
  MissingStoredS3CoordinatorUploadCommit,
  MissingStoredS3CoordinatorUploadGrantIssue,
  ObjectCreatedS3UploadEvent,
  RejectedS3CoordinatorUploadCommit,
  RouteStoredS3CoordinatorUploadEventOptions,
  StoredS3CoordinatorManifest,
  StoredS3CoordinatorManifestOptions,
  StoredS3CoordinatorSlotResolution,
  StoredS3CoordinatorUploadCommit,
  StoredS3CoordinatorUploadCompletion,
  StoredS3CoordinatorUploadEventRoute,
  StoredS3CoordinatorUploadRejection,
  UploadCompletedS3UploadEvent,
} from "./coordinator-types";
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

export function withAuditEvent(
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

export function unknownSlotS3CoordinatorUploadCommit(
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

export function withManifest<T extends { state: CoordinatorPipelineState }>(
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

export function missingStoredS3CoordinatorUploadCommit(): MissingStoredS3CoordinatorUploadCommit {
  return { status: "not_found" };
}

export function missingStoredS3CoordinatorUploadGrantIssue(): MissingStoredS3CoordinatorUploadGrantIssue {
  return { status: "not_found" };
}
