import { MEDIA_OBJECT_KINDS } from "../config/media-object";
import { PUBLICATION_MODES } from "../config/publication";
import {
  type IssueCoordinatorSlotOptions,
  issueCoordinatorSlot,
} from "../protocol";
import type { CoordinatorPipelineState } from "../protocol/coordinator";
import {
  type PublicationControlPolicy,
  resolvePublicationControl,
} from "../state/publication-control";
import type { OlosError } from "../types/errors";
import type { MediaObjectKind } from "../types/media-object";
import type { PublicationMode, UploadSlot } from "../types/upload-slot";
import { assertSafeDeliveryUrl } from "../validation/delivery-url";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { assertSafeMediaObjectKey } from "../validation/object-key";

export type RuntimeSlotIssueRequest = Request | RuntimeSlotIssuePayload;

export interface RuntimeSlotIssuePayload
  extends Omit<IssueCoordinatorSlotOptions, "state"> {}

export interface IssueCoordinatorSlotFromRequestOptions {
  publicationControl?: PublicationControlPolicy;
  request: RuntimeSlotIssueRequest;
  state: CoordinatorPipelineState;
}

export type RuntimeCoordinatorSlotIssue =
  | {
      response: Response;
      slot: UploadSlot;
      state: CoordinatorPipelineState;
      status: "issued";
    }
  | {
      message: string;
      response: Response;
      status: "invalid";
    }
  | {
      error: OlosError;
      response: Response;
      state: CoordinatorPipelineState;
      status: "rejected";
    };

export async function issueCoordinatorSlotFromRequest(
  options: IssueCoordinatorSlotFromRequestOptions
): Promise<RuntimeCoordinatorSlotIssue> {
  const payload = await parseRequest(options.request);

  if (payload.status === "invalid") {
    return payload;
  }

  const publication = resolvePublicationControl({
    operation: "issue_slot",
    policy: options.publicationControl,
  });

  if (publication.status === "blocked") {
    return rejected(publication.error, options.state);
  }

  try {
    const issued = issueCoordinatorSlot({
      ...payload.value,
      publicationControl: options.publicationControl,
      state: options.state,
    });

    return {
      response: jsonResponse({ slot: issued.slot }, 201),
      slot: issued.slot,
      state: issued.state,
      status: "issued",
    };
  } catch (error) {
    return invalid(errorMessage(error));
  }
}

async function parseRequest(
  request: RuntimeSlotIssueRequest
): Promise<
  | { status: "valid"; value: RuntimeSlotIssuePayload }
  | Extract<RuntimeCoordinatorSlotIssue, { status: "invalid" }>
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

function parsePayload(value: unknown): RuntimeSlotIssuePayload {
  if (!isRecord(value)) {
    throw new Error("slot issue request must be a JSON object");
  }

  const kind = mediaObjectKindField(value);
  const deliveryUrl = stringField(value, "deliveryUrl");
  const objectKey = stringField(value, "objectKey");

  assertSafeDeliveryUrl(deliveryUrl, "deliveryUrl");
  assertSafeMediaObjectKey(objectKey, kind, "objectKey");

  return {
    contentType: stringField(value, "contentType"),
    deliveryUrl,
    duration: positiveNumberField(value, "duration"),
    expiresAt: stringField(value, "expiresAt"),
    kind,
    maxBytes: positiveNumberField(value, "maxBytes"),
    mediaSequenceNumber: nonNegativeIntegerField(value, "mediaSequenceNumber"),
    objectKey,
    publicationMode: publicationModeField(value),
    publisherInstanceId: urlSafeIdentifierField(value, "publisherInstanceId"),
    renditionId: urlSafeIdentifierField(value, "renditionId"),
    slotId: urlSafeIdentifierField(value, "slotId"),
    ...optionalNonNegativeIntegerField(value, "minBytes"),
    ...optionalNonNegativeIntegerField(value, "partNumber"),
  };
}

function invalid(
  message: string
): Extract<RuntimeCoordinatorSlotIssue, { status: "invalid" }> {
  return {
    message,
    response: jsonResponse({ error: { message } }, 400),
    status: "invalid",
  };
}

function rejected(
  error: OlosError,
  state: CoordinatorPipelineState
): Extract<RuntimeCoordinatorSlotIssue, { status: "rejected" }> {
  return {
    error,
    response: jsonResponse(error, rejectionStatus(error)),
    state,
    status: "rejected",
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

function urlSafeIdentifierField(
  value: Record<string, unknown>,
  field: string
): string {
  assertUrlSafeIdentifier(value[field], field);

  return value[field];
}

function mediaObjectKindField(value: Record<string, unknown>): MediaObjectKind {
  const kind = stringField(value, "kind");

  if (!MEDIA_OBJECT_KINDS.includes(kind as MediaObjectKind)) {
    throw new Error(`kind must be one of: ${MEDIA_OBJECT_KINDS.join(", ")}`);
  }

  return kind as MediaObjectKind;
}

function publicationModeField(value: Record<string, unknown>): PublicationMode {
  const publicationMode = stringField(value, "publicationMode");

  if (!PUBLICATION_MODES.includes(publicationMode as PublicationMode)) {
    throw new Error(
      `publicationMode must be one of: ${PUBLICATION_MODES.join(", ")}`
    );
  }

  return publicationMode as PublicationMode;
}

function numberField(value: Record<string, unknown>, field: string): number {
  if (typeof value[field] !== "number" || !Number.isFinite(value[field])) {
    throw new Error(`${field} must be a finite number`);
  }

  return value[field];
}

function positiveNumberField(
  value: Record<string, unknown>,
  field: string
): number {
  const number = numberField(value, field);

  if (number <= 0) {
    throw new Error(`${field} must be a positive number`);
  }

  return number;
}

function nonNegativeIntegerField(
  value: Record<string, unknown>,
  field: string
): number {
  const number = numberField(value, field);

  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }

  return number;
}

function optionalNonNegativeIntegerField(
  value: Record<string, unknown>,
  field: "minBytes" | "partNumber"
): Partial<Pick<RuntimeSlotIssuePayload, "minBytes" | "partNumber">> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: nonNegativeIntegerField(value, field) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "invalid slot issue request";
}
