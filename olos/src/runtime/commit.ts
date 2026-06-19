import {
  type CommitCoordinatorUploadOptions,
  type CoordinatorCommitPolicy,
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
  booleanField,
  isRecord,
  nonNegativeNumberField,
  positiveIntegerField,
  positiveNumberField,
  stringField,
  timestampField,
  urlSafeIdentifierField,
} from "./request-fields";
import { jsonResponse } from "./response";

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

    if (committed.status === "rejected") {
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

async function parseRequest(
  request: RuntimeCommitRequest
): Promise<
  | { status: "valid"; value: RuntimeCommitPayload }
  | Extract<RuntimeCoordinatorUploadCommit, { status: "invalid" }>
> {
  if (!(request instanceof Request)) {
    return { status: "valid", value: request };
  }

  try {
    return { status: "valid", value: parsePayload(await request.json()) };
  } catch (error) {
    return invalid(errorMessage(error, "invalid commit request"));
  }
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

function invalid(
  message: string
): Extract<RuntimeCoordinatorUploadCommit, { status: "invalid" }> {
  return {
    message,
    response: jsonResponse({ error: { message } }, 400),
    status: "invalid",
  };
}

function optionalBooleanField(
  value: Record<string, unknown>,
  field: "independent"
): Partial<Pick<RuntimeCommitPayload, "independent">> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: booleanField(value, field) };
}

function optionalPositiveIntegerField(
  value: Record<string, unknown>,
  field: "maxSegments"
): Partial<Pick<RuntimeCommitPayload, "maxSegments">> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: positiveIntegerField(value, field) };
}

function optionalNonNegativeNumberField(
  value: Record<string, unknown>,
  field: "lateToleranceMs"
): Partial<Pick<RuntimeCommitPayload, "lateToleranceMs">> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: nonNegativeNumberField(value, field) };
}

function optionalStringField<Field extends "etag" | "programDateTime">(
  value: Record<string, unknown>,
  field: Field
): Partial<Record<Field, string>> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: stringField(value, field) } as Partial<
    Record<Field, string>
  >;
}

function optionalTimestampField<Field extends "programDateTime">(
  value: Record<string, unknown>,
  field: Field
): Partial<Record<Field, string>> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: timestampField(value, field) } as Partial<
    Record<Field, string>
  >;
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
