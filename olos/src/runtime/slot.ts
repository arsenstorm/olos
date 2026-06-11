import {
  type IssueCoordinatorSlotOptions,
  issueCoordinatorSlot,
} from "../protocol";
import type { CoordinatorPipelineState } from "../protocol/coordinator";
import type { PublicationControlPolicy } from "../state/publication-control";
import type { MediaObjectKind } from "../types/media-object";
import type { PublicationMode, UploadSlot } from "../types/upload-slot";

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
    };

export async function issueCoordinatorSlotFromRequest(
  options: IssueCoordinatorSlotFromRequestOptions
): Promise<RuntimeCoordinatorSlotIssue> {
  const payload = await parseRequest(options.request);

  if (payload.status === "invalid") {
    return payload;
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

  return {
    contentType: stringField(value, "contentType"),
    deliveryUrl: stringField(value, "deliveryUrl"),
    duration: numberField(value, "duration"),
    expiresAt: stringField(value, "expiresAt"),
    kind: stringField(value, "kind") as MediaObjectKind,
    maxBytes: numberField(value, "maxBytes"),
    mediaSequenceNumber: numberField(value, "mediaSequenceNumber"),
    objectKey: stringField(value, "objectKey"),
    publicationMode: stringField(value, "publicationMode") as PublicationMode,
    publisherInstanceId: stringField(value, "publisherInstanceId"),
    renditionId: stringField(value, "renditionId"),
    slotId: stringField(value, "slotId"),
    ...optionalNumberField(value, "minBytes"),
    ...optionalNumberField(value, "partNumber"),
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

function optionalNumberField(
  value: Record<string, unknown>,
  field: "minBytes" | "partNumber"
): Partial<Pick<RuntimeSlotIssuePayload, "minBytes" | "partNumber">> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: numberField(value, field) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "invalid slot issue request";
}
