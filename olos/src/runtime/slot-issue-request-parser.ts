import { isRecord } from "./request-fields";
import {
  parseRuntimeJsonRequest,
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

export async function parseSlotIssueRequest<Invalid>(
  request: Request | RuntimeSlotIssuePayload,
  invalid: (message: string) => Invalid,
  fallbackMessage: string,
  payloadName = "slot issue request"
): Promise<SlotIssueRequestParse<Invalid>> {
  return await parseRuntimeJsonRequest(
    request,
    (value) => parsePayload(value, payloadName),
    invalid,
    fallbackMessage
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
