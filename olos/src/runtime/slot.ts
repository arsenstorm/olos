import { MEDIA_OBJECT_KINDS } from "../config/media-object";
import { PUBLICATION_MODES } from "../config/publication";
import {
  type IssueCoordinatorSlotOptions,
  issueCoordinatorSlot,
} from "../protocol";
import type { CoordinatorPipelineState } from "../protocol/coordinator";
import {
  type PublicationControlPolicy,
  type PublicationControlResolution,
  resolvePublicationControl,
} from "../state/publication-control";
import type { OlosError } from "../types/errors";
import type { UploadSlot } from "../types/upload-slot";
import { assertSafeDeliveryUrl } from "../validation/delivery-url";
import { assertSafeMediaObjectKey } from "../validation/object-key";
import { errorMessage } from "./errors";
import { rejectionStatus } from "./rejection-status";
import {
  isRecord,
  nonNegativeIntegerField,
  oneOfStringField,
  optionalNonNegativeIntegerField,
  positiveNumberField,
  stringField,
  urlSafeIdentifierField,
} from "./request-fields";
import { jsonResponse } from "./response";

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

type BlockedPublicationControl = Extract<
  PublicationControlResolution,
  { status: "blocked" }
>;
type InvalidRuntimeCoordinatorSlotIssue = Extract<
  RuntimeCoordinatorSlotIssue,
  { status: "invalid" }
>;
type RuntimeSlotIssueRequestParse =
  | { status: "valid"; value: RuntimeSlotIssuePayload }
  | InvalidRuntimeCoordinatorSlotIssue;

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

  if (isBlockedPublicationControl(publication)) {
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
    return invalid(errorMessage(error, "invalid slot issue request"));
  }
}

async function parseRequest(
  request: RuntimeSlotIssueRequest
): Promise<RuntimeSlotIssueRequestParse> {
  if (!(request instanceof Request)) {
    return { status: "valid", value: request };
  }

  try {
    return { status: "valid", value: parsePayload(await request.json()) };
  } catch (error) {
    return invalid(errorMessage(error, "invalid slot issue request"));
  }
}

function parsePayload(value: unknown): RuntimeSlotIssuePayload {
  if (!isRecord(value)) {
    throw new Error("slot issue request must be a JSON object");
  }

  const kind = oneOfStringField(value, "kind", MEDIA_OBJECT_KINDS);
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
    publicationMode: oneOfStringField(
      value,
      "publicationMode",
      PUBLICATION_MODES
    ),
    publisherInstanceId: urlSafeIdentifierField(value, "publisherInstanceId"),
    renditionId: urlSafeIdentifierField(value, "renditionId"),
    slotId: urlSafeIdentifierField(value, "slotId"),
    ...optionalNonNegativeIntegerField(value, "minBytes"),
    ...optionalNonNegativeIntegerField(value, "partNumber"),
  };
}

function invalid(message: string): InvalidRuntimeCoordinatorSlotIssue {
  return {
    message,
    response: jsonResponse({ error: { message } }, 400),
    status: "invalid",
  };
}

function isBlockedPublicationControl(
  result: PublicationControlResolution
): result is BlockedPublicationControl {
  return result.status === "blocked";
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
