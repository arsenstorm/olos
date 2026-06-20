import {
  type CommitCoordinatorUploadOptions,
  type CoordinatorCommitPolicy,
  type CoordinatorUploadCommit,
  commitCoordinatorUpload,
} from "../protocol";
import type { CoordinatorPipelineState } from "../protocol/coordinator";
import { createObservedUpload } from "../state/observed-upload";
import type { PublicationControlPolicy } from "../state/publication-control";
import type { OlosError } from "../types/errors";
import { assertSafeObjectKey } from "../validation/object-key";
import type { ObservedUpload } from "../validation/observed-upload";
import { errorMessage } from "./errors";
import { rejectionStatus } from "./rejection-status";
import {
  isRecord,
  optionalBooleanField,
  optionalNonNegativeNumberField,
  optionalPositiveIntegerField,
  optionalStringField,
  optionalTimestampField,
  positiveNumberField,
  stringField,
  timestampField,
  urlSafeIdentifierField,
} from "./request-fields";
import {
  parseRuntimeJsonRequest,
  type RuntimeJsonRequestParse,
} from "./request-json";
import { jsonErrorResponse, jsonResponse } from "./response";

export type RuntimeCommitRequest = Request | RuntimeCommitPayload;

export interface RuntimeObservedUploadPayload
  extends Omit<ObservedUpload, "metadata"> {
  metadata?: Record<string, string | undefined>;
}

export interface RuntimeCommitPayload
  extends Omit<CommitCoordinatorUploadOptions, "object" | "state"> {
  object: RuntimeObservedUploadPayload;
}

export interface CommitCoordinatorUploadFromRequestOptions {
  commitPolicy?: CoordinatorCommitPolicy;
  lateToleranceMs?: number;
  publicationControl?: PublicationControlPolicy;
  request: RuntimeCommitRequest;
  state: CoordinatorPipelineState;
}

export type RuntimeCoordinatorUploadCommit =
  | {
      response: Response;
      state: CoordinatorPipelineState;
      status: "committed" | "idempotent";
    }
  | {
      error: OlosError;
      response: Response;
      state: CoordinatorPipelineState;
      status: "rejected";
    }
  | {
      message: string;
      response: Response;
      status: "invalid";
    };

type RejectedCoordinatorUploadCommit = Extract<
  CoordinatorUploadCommit,
  { status: "rejected" }
>;
type InvalidRuntimeCoordinatorUploadCommit = Extract<
  RuntimeCoordinatorUploadCommit,
  { status: "invalid" }
>;
type RuntimeCommitRequestParse = RuntimeJsonRequestParse<
  RuntimeCommitPayload,
  InvalidRuntimeCoordinatorUploadCommit
>;

export async function commitCoordinatorUploadFromRequest(
  options: CommitCoordinatorUploadFromRequestOptions
): Promise<RuntimeCoordinatorUploadCommit> {
  const payload = await parseRequest(options.request);

  if (payload.status === "invalid") {
    return payload;
  }

  try {
    const committed = commitCoordinatorUpload({
      ...payload.value,
      commitPolicy: options.commitPolicy,
      lateToleranceMs: payload.value.lateToleranceMs ?? options.lateToleranceMs,
      object: createObservedUpload(payload.value.object),
      publicationControl: options.publicationControl,
      state: options.state,
    });

    if (isRejectedCoordinatorUploadCommit(committed)) {
      return {
        error: committed.error,
        response: jsonResponse(
          committed.error,
          rejectionStatus(committed.error)
        ),
        state: committed.state,
        status: "rejected",
      };
    }

    return {
      response: jsonResponse(
        {
          commit: committed.commit,
          ...(committed.cursor === undefined
            ? {}
            : { cursor: committed.cursor }),
        },
        committed.status === "committed" ? 201 : 200
      ),
      state: committed.state,
      status: committed.status,
    };
  } catch (error) {
    return invalid(errorMessage(error, "invalid commit request"));
  }
}

function isRejectedCoordinatorUploadCommit(
  result: CoordinatorUploadCommit
): result is RejectedCoordinatorUploadCommit {
  return result.status === "rejected";
}

async function parseRequest(
  request: RuntimeCommitRequest
): Promise<RuntimeCommitRequestParse> {
  return await parseRuntimeJsonRequest(
    request,
    parsePayload,
    invalid,
    "invalid commit request"
  );
}

function parsePayload(value: unknown): RuntimeCommitPayload {
  if (!isRecord(value)) {
    throw new Error("commit request must be a JSON object");
  }

  return {
    commitId: urlSafeIdentifierField(value, "commitId"),
    committedAt: timestampField(value, "committedAt"),
    object: parseObjectPayload(value.object),
    slotId: urlSafeIdentifierField(value, "slotId"),
    ...optionalBooleanField(value, "independent"),
    ...optionalNonNegativeNumberField(value, "lateToleranceMs"),
    ...optionalPositiveIntegerField(value, "maxSegments"),
    ...optionalTimestampField(value, "programDateTime"),
  };
}

function parseObjectPayload(value: unknown): RuntimeObservedUploadPayload {
  if (!isRecord(value)) {
    throw new Error("object must be a JSON object");
  }

  const objectKey = stringField(value, "objectKey");

  assertSafeObjectKey(objectKey, "object.objectKey");

  return {
    contentType: stringField(value, "contentType"),
    objectKey,
    observedAt: timestampField(value, "observedAt"),
    providerId: urlSafeIdentifierField(value, "providerId"),
    size: positiveNumberField(value, "size"),
    ...optionalStringField(value, "etag"),
    ...optionalMetadataField(value),
  };
}

function invalid(message: string): InvalidRuntimeCoordinatorUploadCommit {
  return {
    message,
    response: jsonErrorResponse(message, 400),
    status: "invalid",
  };
}

function optionalMetadataField(
  value: Record<string, unknown>
): Pick<RuntimeObservedUploadPayload, "metadata"> | Record<string, never> {
  if (value.metadata === undefined) {
    return {};
  }

  if (!isMetadata(value.metadata)) {
    throw new Error("object.metadata must be a string map");
  }

  return { metadata: value.metadata };
}

function isMetadata(
  value: unknown
): value is Record<string, string | undefined> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (entry) => typeof entry === "string" || entry === undefined
    )
  );
}
