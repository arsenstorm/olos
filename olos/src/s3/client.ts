import type { RuntimeFetch } from "../runtime/client";
import {
  fetchFor,
  isRecord,
  jsonPost,
  normalizedBaseUrl,
  optionalRecordPayload,
  recordPayload,
  requiredArrayField,
  requiredRecord,
  requiredRecordField,
  requiredStringField,
  responseBody,
} from "../runtime/http-client";
import {
  S3_ROUTE_ACTIONS,
  s3CompletionHintRoutePathFromOptions,
  s3RoutePathFromOptions,
} from "../runtime/route";
import type { RuntimeSlotIssuePayload } from "../runtime/slot-issue-payload";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { OlosErrorCode } from "../types/errors";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import {
  assertCommit,
  assertUploadGrant,
  assertUploadSlot,
} from "../validation";
import { assertCursor } from "../validation/cursor";
import { assertUrlSafeIdentifier } from "../validation/ids";
import type {
  StoredS3CoordinatorReconciliationResponse,
  StoredS3CoordinatorRetentionResponse,
} from "./http";
import type { StoredS3CoordinatorReconciliationPlan } from "./reconciliation";

export interface S3RuntimeHttpClientOptions {
  baseUrl: string;
  fetch?: RuntimeFetch;
}

export class S3RuntimeHttpError extends Error {
  readonly body: unknown;
  readonly response: Response;
  readonly status: number;

  constructor(message: string, response: Response, body: unknown) {
    super(message);
    this.body = body;
    this.name = "S3RuntimeHttpError";
    this.response = response;
    this.status = response.status;
  }
}

export interface S3RuntimeIssueUploadGrantOptions
  extends S3RuntimeHttpClientOptions {
  payload: RuntimeSlotIssuePayload;
  sessionId: string;
}

export interface S3RuntimeCompleteUploadOptions
  extends S3RuntimeHttpClientOptions {
  payload?: S3RuntimeCompletionHintPayload;
  sessionId: string;
  slotId: string;
}

export interface S3RuntimeCommitUploadOptions
  extends S3RuntimeHttpClientOptions {
  payload: S3RuntimeCommitPayload;
  sessionId: string;
}

export interface S3RuntimePlanReconciliationOptions
  extends S3RuntimeHttpClientOptions {
  payload?: S3RuntimeReconciliationPlanPayload;
  sessionId: string;
}

export interface S3RuntimeReconcileUploadsOptions
  extends S3RuntimeHttpClientOptions {
  payload: S3RuntimeReconciliationPayload;
  sessionId: string;
}

export interface S3RuntimeApplyRetentionOptions
  extends S3RuntimeHttpClientOptions {
  payload: S3RuntimeRetentionPayload;
  sessionId: string;
}

export interface S3RuntimeCommitPayload {
  commitId: string;
  committedAt: string;
  independent?: boolean;
  lateToleranceMs?: number;
  maxSegments?: number;
  objectKey?: string;
  programDateTime?: string;
  providerId?: string;
  slotId: string;
  versionId?: string;
}

export interface S3RuntimeReconciliationPayload {
  committedAt: string;
  independent?: boolean;
  lateToleranceMs?: number;
  maxSegments?: number;
  programDateTime?: string;
  providerId?: string;
  slotIds?: readonly string[];
  versionId?: string;
}

export interface S3RuntimeReconciliationPlanPayload {
  slotIds?: readonly string[];
}

export interface S3RuntimeRetentionPayload {
  now: string;
}

export interface S3RuntimeCompletionHintPayload {
  commitId?: string;
  committedAt?: string;
  etag?: string;
  independent?: boolean;
  lateToleranceMs?: number;
  maxSegments?: number;
  objectKey?: string;
  programDateTime?: string;
  providerId?: string;
  size?: number;
  versionId?: string;
}

export interface S3RuntimeIssueUploadGrantResponse {
  grant: UploadGrant;
  response: Response;
  slot: UploadSlot;
}

export interface S3RuntimeCompleteUploadResponse {
  commit: Commit;
  cursor?: Cursor;
  response: Response;
}

export interface S3RuntimeCommitUploadResponse {
  commit: Commit;
  cursor?: Cursor;
  response: Response;
}

export type S3RuntimeReconciliationPlanResponse =
  StoredS3CoordinatorReconciliationPlan & {
    response: Response;
  };

export type S3RuntimeReconcileUploadsResponse =
  StoredS3CoordinatorReconciliationResponse & {
    response: Response;
  };

export type S3RuntimeApplyRetentionResponse =
  StoredS3CoordinatorRetentionResponse & {
    response: Response;
  };

type S3RuntimeReconciliationResultPayload =
  StoredS3CoordinatorReconciliationResponse["results"][number];

type S3RuntimeReconciliationResultStatus =
  | "committed"
  | "conflict"
  | "failed"
  | "idempotent"
  | "not_found";

const S3_RUNTIME_RECONCILIATION_RESULT_STATUSES = [
  "committed",
  "conflict",
  "failed",
  "idempotent",
  "not_found",
] as const satisfies readonly S3RuntimeReconciliationResultStatus[];
const S3_UPLOAD_GRANT_RESPONSE_FIELDS_MESSAGE =
  "S3 upload grant response must include grant and slot";
const S3_UPLOAD_COMMIT_RESPONSE_FIELDS_MESSAGE =
  "S3 upload completion response must include a commit";
const S3_RECONCILIATION_RESPONSE_RESULTS_MESSAGE =
  "S3 reconciliation response must include results";
const S3_RECONCILIATION_RESPONSE_SUMMARY_MESSAGE =
  "S3 reconciliation response must include summary";
const S3_RECONCILIATION_PLAN_RESPONSE_STATUS_MESSAGE =
  "S3 reconciliation plan response must include status";
const S3_RECONCILIATION_PLAN_RESPONSE_SLOT_IDS_MESSAGE =
  "S3 reconciliation plan response must include planned slotIds";
const S3_RECONCILIATION_PLAN_RESPONSE_SLOTS_MESSAGE =
  "S3 reconciliation plan response must include planned slots";
const S3_RECONCILIATION_PLAN_STATUS_MESSAGE =
  "S3 reconciliation plan response status must be planned or not_found";
const S3_RECONCILIATION_SUMMARY_COMMITTED_MESSAGE =
  "S3 reconciliation response summary must include committed";
const S3_RECONCILIATION_SUMMARY_FAILED_MESSAGE =
  "S3 reconciliation response summary must include failed";
const S3_RECONCILIATION_SUMMARY_IDEMPOTENT_MESSAGE =
  "S3 reconciliation response summary must include idempotent";
const S3_RECONCILIATION_SUMMARY_PLANNED_MESSAGE =
  "S3 reconciliation response summary must include planned";
const S3_RECONCILIATION_SUMMARY_STATUS_MESSAGE =
  "S3 reconciliation response summary must include status";
const S3_RECONCILIATION_SUMMARY_STATUS_VALUE_MESSAGE =
  "S3 reconciliation response summary status must be reconciled";
const S3_RECONCILIATION_SUMMARY_STATUS_VALUE = "reconciled";
const S3_RECONCILIATION_SUMMARY_FAILED_ERROR_CODES_MESSAGE =
  "S3 reconciliation response summary must include failedErrorCodes";
const S3_RECONCILIATION_SUMMARY_FAILED_SLOT_IDS_MESSAGE =
  "S3 reconciliation response summary must include failedSlotIds";
const S3_RECONCILIATION_SUMMARY_SLOT_IDS_MESSAGE =
  "S3 reconciliation response summary must include slotIds";
const S3_RECONCILIATION_SUMMARY_OK_MESSAGE =
  "S3 reconciliation response summary must include ok";
const S3_RETENTION_RESPONSE_ENVELOPE_MESSAGE =
  "S3 retention response must include plan and summary";
const S3_RETENTION_RESPONSE_PLAN_MESSAGE =
  "S3 retention response must include plan";
const S3_RETENTION_RESPONSE_RESULT_MESSAGE =
  "S3 retention response must include result";
const S3_RETENTION_RESPONSE_SUMMARY_MESSAGE =
  "S3 retention response must include summary";
const S3_RETENTION_PLAN_EXPIRED_SLOTS_MESSAGE =
  "S3 retention response plan must include expiredSlots";
const S3_RETENTION_PLAN_RETIRED_OBJECTS_MESSAGE =
  "S3 retention response plan must include retiredObjects";
const S3_RETENTION_PLAN_CURSOR_MESSAGE =
  "S3 retention response plan cursor must be an object";
const S3_RETENTION_RESULT_ENVELOPE_MESSAGE =
  "S3 retention response must include result and summary";
const S3_RETENTION_RESULT_DELETED_OBJECTS_MESSAGE =
  "S3 retention response result must include deletedObjects";
const S3_RETENTION_RESULT_FAILED_OBJECTS_MESSAGE =
  "S3 retention response result must include failedObjects";
const S3_RETENTION_SUMMARY_DELETED_MESSAGE =
  "S3 retention response summary must include deleted";
const S3_RETENTION_SUMMARY_FAILED_MESSAGE =
  "S3 retention response summary must include failed";
const S3_RETENTION_SUMMARY_PLANNED_MESSAGE =
  "S3 retention response summary must include planned";
const S3_RETENTION_SUMMARY_FAILED_OBJECT_KEYS_MESSAGE =
  "S3 retention response summary must include failedObjectKeys";
const S3_RETENTION_SUMMARY_FAILED_SLOT_IDS_MESSAGE =
  "S3 retention response summary must include failedSlotIds";
const S3_RETENTION_SUMMARY_OK_MESSAGE =
  "S3 retention response summary must include ok";

type S3RuntimeSuccessfulReconciliationResultStatus = "committed" | "idempotent";

type S3RuntimeFailedReconciliationResultStatus = Exclude<
  S3RuntimeReconciliationResultStatus,
  S3RuntimeSuccessfulReconciliationResultStatus
>;

interface S3RuntimeCommitPayloadFields {
  commit: Record<string, unknown>;
}

interface S3RuntimeGrantPayloadFields {
  grant: Record<string, unknown>;
  slot: Record<string, unknown>;
}

interface S3RuntimeReconciliationPayloadFields {
  results: unknown;
  summary: Record<string, unknown>;
}

type S3RuntimeReconciliationResultsPayload =
  StoredS3CoordinatorReconciliationResponse["results"];

type S3RuntimeReconciliationPlanStatus =
  StoredS3CoordinatorReconciliationPlan["status"];

const S3_RUNTIME_RECONCILIATION_PLAN_STATUSES = [
  "planned",
  "not_found",
] as const satisfies readonly S3RuntimeReconciliationPlanStatus[];

interface S3RuntimeRetentionPayloadFields {
  plan: Record<string, unknown>;
  result: Record<string, unknown>;
  summary: Record<string, unknown>;
}

type S3RuntimeReconciliationSummaryArrays = Pick<
  StoredS3CoordinatorReconciliationResponse["summary"],
  "failedErrorCodes" | "failedSlotIds" | "slotIds"
>;

type S3RuntimeReconciliationSummaryCounts = Pick<
  StoredS3CoordinatorReconciliationResponse["summary"],
  "committed" | "failed" | "idempotent" | "planned"
>;

type S3RuntimeReconciliationSummaryStatus =
  StoredS3CoordinatorReconciliationResponse["summary"]["status"];

type S3RuntimeReconciliationSummaryOk =
  StoredS3CoordinatorReconciliationResponse["summary"]["ok"];

type S3RuntimeRetentionSummaryArrays = Pick<
  StoredS3CoordinatorRetentionResponse["summary"],
  "failedObjectKeys" | "failedSlotIds"
>;

type S3RuntimeRetentionSummaryCounts = Pick<
  StoredS3CoordinatorRetentionResponse["summary"],
  "deleted" | "failed" | "planned"
>;

type S3RuntimeRetentionSummaryOk =
  StoredS3CoordinatorRetentionResponse["summary"]["ok"];

interface S3RuntimeRetiredObjectPayload {
  commitId: string;
  objectKey: string;
  slotId: string;
}

type S3RuntimeRetentionDeletedObjectsPayload =
  StoredS3CoordinatorRetentionResponse["result"]["deletedObjects"];

type S3RuntimeRetentionExpiredSlotsPayload =
  StoredS3CoordinatorRetentionResponse["plan"]["expiredSlots"];

type S3RuntimeRetentionFailedObjectPayload =
  StoredS3CoordinatorRetentionResponse["result"]["failedObjects"][number];

type S3RuntimeRetentionRetiredObjectsPayload =
  StoredS3CoordinatorRetentionResponse["plan"]["retiredObjects"];

type S3RuntimeOptionalCursorPayload = Partial<Record<"cursor", Cursor>>;

export async function issueS3RuntimeUploadGrant(
  options: S3RuntimeIssueUploadGrantOptions
): Promise<S3RuntimeIssueUploadGrantResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, `${S3_ROUTE_ACTIONS.slots}`),
    jsonPost(options.payload)
  );

  if (!response.ok) {
    throw await s3RuntimeHttpError("S3 upload grant issue", response);
  }

  return {
    ...grantPayload(await response.json()),
    response,
  };
}

export async function completeS3RuntimeUpload(
  options: S3RuntimeCompleteUploadOptions
): Promise<S3RuntimeCompleteUploadResponse> {
  const response = await fetchFor(options)(
    completionUrl(options.baseUrl, options.sessionId, options.slotId),
    jsonPost(options.payload ?? {})
  );

  if (!response.ok) {
    throw await s3RuntimeHttpError("S3 upload completion", response);
  }

  return {
    ...commitPayload(await response.json()),
    response,
  };
}

export async function commitS3RuntimeUpload(
  options: S3RuntimeCommitUploadOptions
): Promise<S3RuntimeCommitUploadResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, S3_ROUTE_ACTIONS.commits),
    jsonPost(options.payload)
  );

  if (!response.ok) {
    throw await s3RuntimeHttpError("S3 upload commit", response);
  }

  return {
    ...commitPayload(await response.json()),
    response,
  };
}

export async function planS3RuntimeReconciliation(
  options: S3RuntimePlanReconciliationOptions
): Promise<S3RuntimeReconciliationPlanResponse> {
  const response = await fetchFor(options)(
    sessionUrl(
      options.baseUrl,
      options.sessionId,
      S3_ROUTE_ACTIONS.reconcilePlan
    ),
    jsonPost(options.payload ?? {})
  );

  if (!response.ok) {
    throw await s3RuntimeHttpError("S3 reconciliation plan", response);
  }

  return {
    ...reconciliationPlanPayload(await response.json()),
    response,
  };
}

export async function reconcileS3RuntimeUploads(
  options: S3RuntimeReconcileUploadsOptions
): Promise<S3RuntimeReconcileUploadsResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, S3_ROUTE_ACTIONS.reconcile),
    jsonPost(options.payload)
  );

  if (!response.ok) {
    throw await s3RuntimeHttpError("S3 upload reconciliation", response);
  }

  return {
    ...reconciliationPayload(await response.json()),
    response,
  };
}

export async function applyS3RuntimeRetention(
  options: S3RuntimeApplyRetentionOptions
): Promise<S3RuntimeApplyRetentionResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, S3_ROUTE_ACTIONS.retention),
    jsonPost(options.payload)
  );

  if (!response.ok) {
    throw await s3RuntimeHttpError("S3 retention", response);
  }

  return {
    ...retentionPayload(await response.json()),
    response,
  };
}

function sessionUrl(baseUrl: string, sessionId: string, action: string): URL {
  assertUrlSafeIdentifier(sessionId, "sessionId");

  return new URL(
    s3RoutePathFromOptions(sessionId, action, {}),
    normalizedBaseUrl(baseUrl)
  );
}

function completionUrl(
  baseUrl: string,
  sessionId: string,
  slotId: string
): URL {
  assertUrlSafeIdentifier(sessionId, "sessionId");
  assertUrlSafeIdentifier(slotId, "slotId");

  return new URL(
    s3CompletionHintRoutePathFromOptions(sessionId, slotId, {}),
    normalizedBaseUrl(baseUrl)
  );
}

async function s3RuntimeHttpError(
  operation: string,
  response: Response
): Promise<S3RuntimeHttpError> {
  return new S3RuntimeHttpError(
    `${operation} failed with status ${response.status}`,
    response,
    await responseBody(response)
  );
}

function grantPayload(
  value: unknown
): Omit<S3RuntimeIssueUploadGrantResponse, "response"> {
  const fields = grantPayloadFields(value);

  return {
    grant: uploadGrantPayload(fields.grant),
    slot: uploadSlotPayload(fields.slot),
  };
}

function uploadGrantPayload(value: Record<string, unknown>): UploadGrant {
  return recordPayload<UploadGrant>(value, assertUploadGrant);
}

function uploadSlotPayload(value: Record<string, unknown>): UploadSlot {
  return recordPayload<UploadSlot>(value, assertUploadSlot);
}

function grantPayloadFields(value: unknown): S3RuntimeGrantPayloadFields {
  return {
    grant: requiredRecordField(
      value,
      "grant",
      S3_UPLOAD_GRANT_RESPONSE_FIELDS_MESSAGE
    ),
    slot: requiredRecordField(
      value,
      "slot",
      S3_UPLOAD_GRANT_RESPONSE_FIELDS_MESSAGE
    ),
  };
}

function commitPayload(
  value: unknown
): Omit<S3RuntimeCompleteUploadResponse, "response"> {
  const fields = commitPayloadFields(value);

  return {
    commit: commitResponsePayload(fields.commit),
    ...optionalCommitPayloadCursor(value),
  };
}

function commitResponsePayload(value: Record<string, unknown>): Commit {
  return recordPayload<Commit>(value, assertCommit);
}

function commitPayloadFields(value: unknown): S3RuntimeCommitPayloadFields {
  return {
    commit: requiredRecordField(
      value,
      "commit",
      S3_UPLOAD_COMMIT_RESPONSE_FIELDS_MESSAGE
    ),
  };
}

function optionalCommitPayloadCursor(
  value: unknown
): S3RuntimeOptionalCursorPayload {
  return optionalCursorPayload(value);
}

function optionalCursorPayload(value: unknown): S3RuntimeOptionalCursorPayload {
  return optionalRecordPayload<"cursor", Cursor>(value, "cursor", assertCursor);
}

function reconciliationPlanPayload(
  value: unknown
): StoredS3CoordinatorReconciliationPlan {
  const record = requiredRecord(
    value,
    S3_RECONCILIATION_PLAN_RESPONSE_STATUS_MESSAGE
  );
  const status = reconciliationPlanStatus(record);

  if (status === "not_found") {
    return missingReconciliationPlanPayload();
  }

  return plannedReconciliationPlanPayload(record);
}

function missingReconciliationPlanPayload(): StoredS3CoordinatorReconciliationPlan {
  return { status: "not_found" };
}

function plannedReconciliationPlanPayload(
  value: Record<string, unknown>
): StoredS3CoordinatorReconciliationPlan {
  return {
    status: "planned",
    slotIds: reconciliationPlanSlotIds(value),
    slots: reconciliationPlanSlots(value),
  };
}

function reconciliationPlanStatus(
  value: Record<string, unknown>
): S3RuntimeReconciliationPlanStatus {
  const status = requiredStringField(
    value,
    "status",
    S3_RECONCILIATION_PLAN_RESPONSE_STATUS_MESSAGE
  );

  if (!isReconciliationPlanStatus(status)) {
    throw new Error(S3_RECONCILIATION_PLAN_STATUS_MESSAGE);
  }

  return status;
}

function isReconciliationPlanStatus(
  status: string
): status is S3RuntimeReconciliationPlanStatus {
  return isStringInSet(status, S3_RUNTIME_RECONCILIATION_PLAN_STATUSES);
}

function reconciliationPlanSlotIds(
  value: Record<string, unknown>
): readonly string[] {
  const slotIds = requiredArrayField(
    value,
    "slotIds",
    S3_RECONCILIATION_PLAN_RESPONSE_SLOT_IDS_MESSAGE
  );

  return slotIds.map((slotId, index) => {
    if (typeof slotId !== "string") {
      throw new Error(reconciliationPlanSlotIdContext(index));
    }

    return slotId;
  });
}

function reconciliationPlanSlotIdContext(index: number): string {
  return `S3 reconciliation plan slotIds[${index}] must be a string`;
}

function reconciliationPlanSlots(
  value: Record<string, unknown>
): readonly UploadSlot[] {
  const slots = requiredArrayField(
    value,
    "slots",
    S3_RECONCILIATION_PLAN_RESPONSE_SLOTS_MESSAGE
  );

  return slots.map((slot, index) => {
    try {
      assertUploadSlot(slot);
    } catch (error) {
      throw new Error(
        reconciliationPlanSlotValidContext(index, (error as Error).message)
      );
    }

    return slot;
  });
}

function reconciliationPlanSlotValidContext(
  index: number,
  message: string
): string {
  return `S3 reconciliation plan slots[${index}] must be valid: ${message}`;
}

function reconciliationPayload(
  value: unknown
): StoredS3CoordinatorReconciliationResponse {
  const record = requiredRecord(
    value,
    S3_RECONCILIATION_RESPONSE_RESULTS_MESSAGE
  );

  const fields = reconciliationPayloadFields(record);

  return {
    results: reconciliationResultsCollectionPayload(fields),
    summary: reconciliationSummaryPayload(fields.summary),
  };
}

function reconciliationPayloadFields(
  value: Record<string, unknown>
): S3RuntimeReconciliationPayloadFields {
  return {
    results: value.results,
    summary: requiredRecordField(
      value,
      "summary",
      S3_RECONCILIATION_RESPONSE_SUMMARY_MESSAGE
    ),
  };
}

function reconciliationResultsCollectionPayload(
  value: S3RuntimeReconciliationPayloadFields
): S3RuntimeReconciliationResultsPayload {
  const results = requiredArrayField(
    value,
    "results",
    S3_RECONCILIATION_RESPONSE_RESULTS_MESSAGE
  );

  return results.map((result, index) =>
    reconciliationResultPayload(result, index)
  );
}

function reconciliationResultPayload(
  value: unknown,
  index: number
): S3RuntimeReconciliationResultPayload {
  const resultRecord = requiredRecord(
    value,
    reconciliationResultObjectContext(index)
  );
  const status = reconciliationResultStatus(resultRecord, index);
  const slotId = requiredStringField(
    resultRecord,
    "slotId",
    reconciliationResultSlotIdContext(index)
  );

  if (isSuccessfulReconciliationResultStatus(status)) {
    return successfulReconciliationResultPayload(
      resultRecord,
      index,
      slotId,
      status
    );
  }

  return failedReconciliationResultPayload(status, index, slotId);
}

function reconciliationResultStatus(
  value: Record<string, unknown>,
  index: number
): S3RuntimeReconciliationResultStatus {
  const status = requiredStringField(
    value,
    "status",
    `S3 reconciliation response results[${index}] must include status`
  );

  if (!isReconciliationResultStatus(status)) {
    throw new Error(reconciliationResultUnknownStatusContext(index));
  }

  return status;
}

function isReconciliationResultStatus(
  status: string
): status is S3RuntimeReconciliationResultStatus {
  return isStringInSet(status, S3_RUNTIME_RECONCILIATION_RESULT_STATUSES);
}

function isStringInSet<const Value extends string>(
  value: string,
  values: readonly Value[]
): value is Value {
  return values.includes(value as Value);
}

function isSuccessfulReconciliationResultStatus(
  status: S3RuntimeReconciliationResultStatus
): status is S3RuntimeSuccessfulReconciliationResultStatus {
  return status === "committed" || status === "idempotent";
}

function successfulReconciliationResultPayload(
  value: Record<string, unknown>,
  index: number,
  slotId: string,
  status: S3RuntimeSuccessfulReconciliationResultStatus
): S3RuntimeReconciliationResultPayload {
  const commit = requiredRecordField(
    value,
    "commit",
    reconciliationResultCommitContext(index)
  );

  assertCommit(commit);

  return {
    commit,
    slotId,
    status,
    ...optionalReconciliationResultCursor(value),
  };
}

function optionalReconciliationResultCursor(
  value: Record<string, unknown>
): S3RuntimeOptionalCursorPayload {
  return optionalCursorPayload(value);
}

function failedReconciliationResultPayload(
  status: S3RuntimeFailedReconciliationResultStatus,
  index: number,
  slotId: string
): S3RuntimeReconciliationResultPayload {
  if (status === "failed") {
    return { slotId, status };
  }

  throw new Error(reconciliationResultUnsupportedStatusContext(index));
}

function reconciliationResultObjectContext(index: number): string {
  return `S3 reconciliation response results[${index}] must be an object`;
}

function reconciliationResultSlotIdContext(index: number): string {
  return `S3 reconciliation response results[${index}] must include slotId`;
}

function reconciliationResultCommitContext(index: number): string {
  return `S3 reconciliation response results[${index}] must include commit`;
}

function reconciliationResultUnknownStatusContext(index: number): string {
  return `S3 reconciliation response results[${index}] status must be committed, idempotent, failed, conflict, or not_found`;
}

function reconciliationResultUnsupportedStatusContext(index: number): string {
  return `S3 reconciliation response results[${index}] status must be committed, idempotent, or failed`;
}

function retentionPayload(
  value: unknown
): StoredS3CoordinatorRetentionResponse {
  const record = requiredRecord(value, S3_RETENTION_RESPONSE_ENVELOPE_MESSAGE);

  const fields = retentionPayloadFields(record);

  return {
    plan: retentionPlanPayload(fields.plan),
    result: retentionResultPayload(fields.result),
    summary: retentionSummary(fields.summary),
  };
}

function retentionPayloadFields(
  value: Record<string, unknown>
): S3RuntimeRetentionPayloadFields {
  return {
    plan: requiredRecordField(
      value,
      "plan",
      S3_RETENTION_RESPONSE_PLAN_MESSAGE
    ),
    result: requiredRecordField(
      value,
      "result",
      S3_RETENTION_RESPONSE_RESULT_MESSAGE
    ),
    summary: requiredRecordField(
      value,
      "summary",
      S3_RETENTION_RESPONSE_SUMMARY_MESSAGE
    ),
  };
}

function retentionPlanPayload(
  value: unknown
): StoredS3CoordinatorRetentionResponse["plan"] {
  if (!isRecord(value)) {
    throw new Error("S3 retention response plan must be an object");
  }

  const parsedExpiredSlots = retentionPlanExpiredSlotsPayload(value);

  const parsedRetiredObjects = retentionPlanRetiredObjectsPayload(value);

  const cursor = optionalRetentionPlanCursor(value);

  return {
    expiredSlots: parsedExpiredSlots,
    retiredObjects: parsedRetiredObjects,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function retentionPlanExpiredSlotsPayload(
  value: Record<string, unknown>
): S3RuntimeRetentionExpiredSlotsPayload {
  return requiredArrayField(
    value,
    "expiredSlots",
    S3_RETENTION_PLAN_EXPIRED_SLOTS_MESSAGE
  ).map((slot, index) => retentionExpiredSlotPayload(slot, index));
}

function retentionPlanRetiredObjectsPayload(
  value: Record<string, unknown>
): S3RuntimeRetentionRetiredObjectsPayload {
  return requiredArrayField(
    value,
    "retiredObjects",
    S3_RETENTION_PLAN_RETIRED_OBJECTS_MESSAGE
  ).map((retiredObject, index) =>
    retiredObjectPayload(
      retiredObject,
      `S3 retention response plan.retiredObjects[${index}]`
    )
  );
}

function retentionExpiredSlotPayload(
  value: unknown,
  index: number
): UploadSlot {
  if (!isRecord(value)) {
    throw new Error(retentionExpiredSlotObjectContext(index));
  }

  try {
    assertUploadSlot(value);
  } catch (error) {
    throw new Error(
      retentionExpiredSlotValidContext(index, (error as Error).message)
    );
  }

  return value;
}

function retentionExpiredSlotObjectContext(index: number): string {
  return `S3 retention response plan.expiredSlots[${index}] must be an object`;
}

function retentionExpiredSlotValidContext(
  index: number,
  message: string
): string {
  return `S3 retention response plan.expiredSlots[${index}] must be valid: ${message}`;
}

function optionalRetentionPlanCursor(
  value: Record<string, unknown>
): Cursor | undefined {
  if (value.cursor === undefined) {
    return;
  }

  if (!isRecord(value.cursor)) {
    throw new Error(S3_RETENTION_PLAN_CURSOR_MESSAGE);
  }

  assertCursor(value.cursor);
  return value.cursor;
}

function retentionResultPayload(
  value: unknown
): StoredS3CoordinatorRetentionResponse["result"] {
  const record = requiredRecord(value, S3_RETENTION_RESULT_ENVELOPE_MESSAGE);

  return {
    deletedObjects: retentionDeletedObjectsPayload(record),
    failedObjects: retentionFailedObjectsPayload(record),
  };
}

function retentionDeletedObjectsPayload(
  value: Record<string, unknown>
): S3RuntimeRetentionDeletedObjectsPayload {
  const deletedObjects = requiredArrayField(
    value,
    "deletedObjects",
    S3_RETENTION_RESULT_DELETED_OBJECTS_MESSAGE
  );

  return deletedObjects.map((entry, index) =>
    retiredObjectPayload(
      entry,
      `S3 retention response result.deletedObjects[${index}]`
    )
  );
}

function retentionFailedObjectsPayload(
  value: Record<string, unknown>
): StoredS3CoordinatorRetentionResponse["result"]["failedObjects"] {
  const failedObjects = requiredArrayField(
    value,
    "failedObjects",
    S3_RETENTION_RESULT_FAILED_OBJECTS_MESSAGE
  );

  return failedObjects.map((entry, index) =>
    retentionFailedObjectPayload(entry, index)
  );
}

function retentionFailedObjectPayload(
  value: unknown,
  index: number
): S3RuntimeRetentionFailedObjectPayload {
  const failure = requiredRecord(value, retentionFailedObjectContext(index));

  const object = retiredObjectPayload(
    failure.object,
    retentionFailedObjectObjectContext(index)
  );

  return {
    error: requiredStringField(
      failure,
      "error",
      retentionFailedObjectErrorContext(index)
    ),
    object,
  };
}

function retentionFailedObjectContext(index: number): string {
  return `S3 retention response result.failedObjects[${index}] must be an object`;
}

function retentionFailedObjectObjectContext(index: number): string {
  return `S3 retention response result.failedObjects[${index}].object`;
}

function retentionFailedObjectErrorContext(index: number): string {
  return `S3 retention response result.failedObjects[${index}].error must be set`;
}

function retentionSummary(
  value: Record<string, unknown>
): StoredS3CoordinatorRetentionResponse["summary"] {
  const counts = retentionSummaryCounts(value);
  const arrays = retentionSummaryArrays(value);
  const ok = retentionSummaryOk(value);

  return {
    ...counts,
    ...arrays,
    ok,
  };
}

function retentionSummaryArrays(
  value: Record<string, unknown>
): S3RuntimeRetentionSummaryArrays {
  return {
    failedObjectKeys: requiredStringArrayField(
      value,
      "failedObjectKeys",
      S3_RETENTION_SUMMARY_FAILED_OBJECT_KEYS_MESSAGE
    ),
    failedSlotIds: requiredStringArrayField(
      value,
      "failedSlotIds",
      S3_RETENTION_SUMMARY_FAILED_SLOT_IDS_MESSAGE
    ),
  };
}

function retentionSummaryOk(
  value: Record<string, unknown>
): S3RuntimeRetentionSummaryOk {
  return summaryOk(value, S3_RETENTION_SUMMARY_OK_MESSAGE);
}

function reconciliationSummaryPayload(
  value: Record<string, unknown>
): StoredS3CoordinatorReconciliationResponse["summary"] {
  const counts = reconciliationSummaryCounts(value);
  const status = reconciliationSummaryStatus(value);
  const arrays = reconciliationSummaryArrays(value);
  const ok = reconciliationSummaryOk(value);

  return {
    ...counts,
    ...arrays,
    ok,
    status,
  };
}

function retentionSummaryCounts(
  value: Record<string, unknown>
): S3RuntimeRetentionSummaryCounts {
  return {
    deleted: requiredSummaryNumber(
      value,
      "deleted",
      S3_RETENTION_SUMMARY_DELETED_MESSAGE
    ),
    failed: requiredSummaryNumber(
      value,
      "failed",
      S3_RETENTION_SUMMARY_FAILED_MESSAGE
    ),
    planned: requiredSummaryNumber(
      value,
      "planned",
      S3_RETENTION_SUMMARY_PLANNED_MESSAGE
    ),
  };
}

function reconciliationSummaryCounts(
  value: Record<string, unknown>
): S3RuntimeReconciliationSummaryCounts {
  return {
    committed: requiredSummaryNumber(
      value,
      "committed",
      S3_RECONCILIATION_SUMMARY_COMMITTED_MESSAGE
    ),
    failed: requiredSummaryNumber(
      value,
      "failed",
      S3_RECONCILIATION_SUMMARY_FAILED_MESSAGE
    ),
    idempotent: requiredSummaryNumber(
      value,
      "idempotent",
      S3_RECONCILIATION_SUMMARY_IDEMPOTENT_MESSAGE
    ),
    planned: requiredSummaryNumber(
      value,
      "planned",
      S3_RECONCILIATION_SUMMARY_PLANNED_MESSAGE
    ),
  };
}

function reconciliationSummaryStatus(
  value: Record<string, unknown>
): S3RuntimeReconciliationSummaryStatus {
  const status = requiredStringField(
    value,
    "status",
    S3_RECONCILIATION_SUMMARY_STATUS_MESSAGE
  );

  if (status !== S3_RECONCILIATION_SUMMARY_STATUS_VALUE) {
    throw new Error(S3_RECONCILIATION_SUMMARY_STATUS_VALUE_MESSAGE);
  }

  return status;
}

function reconciliationSummaryErrorCodes(
  value: Record<string, unknown>
): readonly OlosErrorCode[] {
  return requiredStringArrayField(
    value,
    "failedErrorCodes",
    S3_RECONCILIATION_SUMMARY_FAILED_ERROR_CODES_MESSAGE
  ) as readonly OlosErrorCode[];
}

function reconciliationSummaryArrays(
  value: Record<string, unknown>
): S3RuntimeReconciliationSummaryArrays {
  return {
    failedErrorCodes: reconciliationSummaryErrorCodes(value),
    failedSlotIds: requiredStringArrayField(
      value,
      "failedSlotIds",
      S3_RECONCILIATION_SUMMARY_FAILED_SLOT_IDS_MESSAGE
    ),
    slotIds: requiredStringArrayField(
      value,
      "slotIds",
      S3_RECONCILIATION_SUMMARY_SLOT_IDS_MESSAGE
    ),
  };
}

function reconciliationSummaryOk(
  value: Record<string, unknown>
): S3RuntimeReconciliationSummaryOk {
  return summaryOk(value, S3_RECONCILIATION_SUMMARY_OK_MESSAGE);
}

function summaryOk(value: Record<string, unknown>, message: string): boolean {
  return requiredSummaryBoolean(value, "ok", message);
}

function retiredObjectPayload(
  value: unknown,
  context: string
): S3RuntimeRetiredObjectPayload {
  const retired = requiredRecord(value, `${context} must be an object`);

  return {
    commitId: retiredObjectStringField(retired, "commitId", context),
    objectKey: retiredObjectStringField(retired, "objectKey", context),
    slotId: retiredObjectStringField(retired, "slotId", context),
  };
}

function retiredObjectStringField(
  value: Record<string, unknown>,
  field: keyof S3RuntimeRetiredObjectPayload,
  context: string
): string {
  return requiredStringField(value, field, `${context}.${field} must be set`);
}

function requiredSummaryBoolean(
  value: Record<string, unknown>,
  field: string,
  message: string
): boolean {
  if (typeof value[field] !== "boolean") {
    throw new Error(message);
  }

  return value[field];
}

function requiredSummaryNumber(
  value: Record<string, unknown>,
  field: string,
  message: string
): number {
  if (typeof value[field] !== "number") {
    throw new Error(message);
  }

  return value[field];
}

function requiredStringArrayField(
  value: Record<string, unknown>,
  field: string,
  message: string
): readonly string[] {
  const values = requiredArrayField(value, field, message);

  for (const [index, item] of values.entries()) {
    if (typeof item !== "string") {
      throw new Error(requiredStringArrayItemMessage(message, index));
    }
  }

  return values as readonly string[];
}

function requiredStringArrayItemMessage(
  message: string,
  index: number
): string {
  return `${message}[${index}] must be a string`;
}
