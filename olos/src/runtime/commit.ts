import {
  type CommitCoordinatorUploadOptions,
  type CoordinatorCommitPolicy,
  commitCoordinatorUpload,
} from "../protocol";
import type { CoordinatorPipelineState } from "../protocol/coordinator";
import { createObservedUpload } from "../state/observed-upload";
import type { PublicationControlPolicy } from "../state/publication-control";
import type { OlosError } from "../types/errors";
import type { ObservedUpload } from "../validation/observed-upload";

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
    return invalid(errorMessage(error));
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
    return invalid(errorMessage(error));
  }
}

function parsePayload(value: unknown): RuntimeCommitPayload {
  if (!isRecord(value)) {
    throw new Error("commit request must be a JSON object");
  }

  return {
    commitId: stringField(value, "commitId"),
    committedAt: stringField(value, "committedAt"),
    object: parseObjectPayload(value.object),
    slotId: stringField(value, "slotId"),
    ...optionalBooleanField(value, "independent"),
    ...optionalNumberField(value, "maxSegments"),
    ...optionalStringField(value, "programDateTime"),
  };
}

function parseObjectPayload(value: unknown): RuntimeObservedUploadPayload {
  if (!isRecord(value)) {
    throw new Error("object must be a JSON object");
  }

  return {
    contentType: stringField(value, "contentType"),
    objectKey: stringField(value, "objectKey"),
    observedAt: stringField(value, "observedAt"),
    providerId: stringField(value, "providerId"),
    size: numberField(value, "size"),
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

function rejectionStatus(error: OlosError): number {
  return error.error.code === "olos.unknown_slot" ? 404 : 409;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, field: string): string {
  if (typeof value[field] !== "string") {
    throw new Error(`${field} must be a string`);
  }

  return value[field];
}

function numberField(value: Record<string, unknown>, field: string): number {
  if (typeof value[field] !== "number" || !Number.isFinite(value[field])) {
    throw new Error(`${field} must be a finite number`);
  }

  return value[field];
}

function optionalBooleanField(
  value: Record<string, unknown>,
  field: "independent"
): Partial<Pick<RuntimeCommitPayload, "independent">> {
  if (value[field] === undefined) {
    return {};
  }

  if (typeof value[field] !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }

  return { [field]: value[field] };
}

function optionalNumberField(
  value: Record<string, unknown>,
  field: "maxSegments"
): Partial<Pick<RuntimeCommitPayload, "maxSegments">> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: numberField(value, field) };
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "invalid commit request";
}
