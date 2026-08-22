import { isRecord } from "../validation/fields";
import {
  parseRuntimeJsonRequest,
  type RuntimeJsonRequestInvalidBuilder,
  type RuntimeJsonRequestParse,
} from "./request-json";
import {
  parseRuntimeSlotIssuePayload,
  type RuntimeSlotIssuePayload,
} from "./slot-issue-payload";

export type SlotIssueRequestParse<Invalid> = RuntimeJsonRequestParse<
  RuntimeSlotIssuePayload,
  Invalid
>;

export function parseSlotIssueRequest<Invalid>(
  request: Request | RuntimeSlotIssuePayload,
  invalid: RuntimeJsonRequestInvalidBuilder<Invalid>,
  fallbackMessage: string,
  payloadName = "slot issue request",
  maxBodyBytes?: number
): Promise<SlotIssueRequestParse<Invalid>> {
  return parseRuntimeJsonRequest(
    request,
    (value) => parsePayload(value, payloadName),
    invalid,
    fallbackMessage,
    maxBodyBytes
  );
}

function parsePayload(
  value: unknown,
  payloadName: string
): RuntimeSlotIssuePayload {
  if (!isRecord(value)) {
    throw new Error(`${payloadName} must be a JSON object`);
  }

  return parseRuntimeSlotIssuePayload(value);
}
