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
  const grant = requiredRecordField(
    value,
    "grant",
    "S3 upload grant response must include grant and slot"
  );
  const slot = requiredRecordField(
    value,
    "slot",
    "S3 upload grant response must include grant and slot"
  );

  return {
    grant: recordPayload<UploadGrant>(grant, assertUploadGrant),
    slot: recordPayload<UploadSlot>(slot, assertUploadSlot),
  };
}

function commitPayload(
  value: unknown
): Omit<S3RuntimeCompleteUploadResponse, "response"> {
  const commit = requiredRecordField(
    value,
    "commit",
    "S3 upload completion response must include a commit"
  );

  return {
    commit: recordPayload<Commit>(commit, assertCommit),
    ...optionalCursorPayload(value),
  };
}

function optionalCursorPayload(
  value: unknown
): Pick<S3RuntimeCompleteUploadResponse, "cursor"> | Record<string, never> {
  return optionalRecordPayload<"cursor", Cursor>(value, "cursor", assertCursor);
}

function reconciliationPlanPayload(
  value: unknown
): StoredS3CoordinatorReconciliationPlan {
  const record = requiredRecord(
    value,
    "S3 reconciliation plan response must include status"
  );
  const status = requiredStringField(
    record,
    "status",
    "S3 reconciliation plan response must include status"
  );

  if (status !== "planned" && status !== "not_found") {
    throw new Error(
      "S3 reconciliation plan response status must be planned or not_found"
    );
  }

  if (status === "not_found") {
    return { status: "not_found" };
  }

  const slotIds = requiredArrayField(
    record,
    "slotIds",
    "S3 reconciliation plan response must include planned slotIds"
  );
  const slots = requiredArrayField(
    record,
    "slots",
    "S3 reconciliation plan response must include planned slots"
  );

  const validSlotIds = slotIds.map((slotId, index) => {
    if (typeof slotId !== "string") {
      throw new Error(
        `S3 reconciliation plan slotIds[${index}] must be a string`
      );
    }

    return slotId;
  });

  const parsedSlots = slots.map((slot, index) => {
    try {
      assertUploadSlot(slot);
    } catch (error) {
      throw new Error(
        `S3 reconciliation plan slots[${index}] must be valid: ${
          (error as Error).message
        }`
      );
    }

    return slot;
  });

  return {
    status: "planned",
    slotIds: validSlotIds,
    slots: parsedSlots,
  };
}

function reconciliationPayload(
  value: unknown
): StoredS3CoordinatorReconciliationResponse {
  const record = requiredRecord(
    value,
    "S3 reconciliation response must include results"
  );

  const results = requiredArrayField(
    record,
    "results",
    "S3 reconciliation response must include results"
  );
  const validResults: StoredS3CoordinatorReconciliationResponse["results"] =
    results.map((result, index) => {
      const resultRecord = requiredRecord(
        result,
        `S3 reconciliation response results[${index}] must be an object`
      );
      const status = requiredStringField(
        resultRecord,
        "status",
        `S3 reconciliation response results[${index}] must include status`
      );

      if (
        status !== "failed" &&
        status !== "conflict" &&
        status !== "not_found" &&
        status !== "committed" &&
        status !== "idempotent"
      ) {
        throw new Error(
          `S3 reconciliation response results[${index}] status must be committed, idempotent, failed, conflict, or not_found`
        );
      }

      const slotId = requiredStringField(
        resultRecord,
        "slotId",
        `S3 reconciliation response results[${index}] must include slotId`
      );

      if (status === "committed" || status === "idempotent") {
        const commit = requiredRecordField(
          resultRecord,
          "commit",
          `S3 reconciliation response results[${index}] must include commit`
        );

        assertCommit(commit);

        return {
          commit,
          slotId,
          status,
          ...optionalRecordPayload<"cursor", Cursor>(
            resultRecord,
            "cursor",
            assertCursor
          ),
        };
      }

      if (status === "failed") {
        return {
          slotId,
          status,
        };
      }

      throw new Error(
        `S3 reconciliation response results[${index}] status must be committed, idempotent, or failed`
      );
    });

  const summary = requiredRecordField(
    record,
    "summary",
    "S3 reconciliation response must include summary"
  );

  return {
    results: validResults,
    summary: summaryPayload(summary),
  };
}

function retentionPayload(
  value: unknown
): StoredS3CoordinatorRetentionResponse {
  const record = requiredRecord(
    value,
    "S3 retention response must include plan and summary"
  );

  const plan = requiredRecordField(
    record,
    "plan",
    "S3 retention response must include plan"
  );
  const result = requiredRecordField(
    record,
    "result",
    "S3 retention response must include result"
  );
  const summary = requiredRecordField(
    record,
    "summary",
    "S3 retention response must include summary"
  );
  return {
    plan: assertCoordinatorRetentionPlan(plan),
    result: retentionResult(result),
    summary: retentionSummary(summary),
  };
}

function assertCoordinatorRetentionPlan(
  value: unknown
): StoredS3CoordinatorRetentionResponse["plan"] {
  if (!isRecord(value)) {
    throw new Error("S3 retention response plan must be an object");
  }

  const expiredSlots = requiredArrayField(
    value,
    "expiredSlots",
    "S3 retention response plan must include expiredSlots"
  );
  const parsedExpiredSlots = expiredSlots.map((slot, index) => {
    if (!isRecord(slot)) {
      throw new Error(
        `S3 retention response plan.expiredSlots[${index}] must be an object`
      );
    }

    try {
      assertUploadSlot(slot);
    } catch (error) {
      throw new Error(
        `S3 retention response plan.expiredSlots[${index}] must be valid: ${
          (error as Error).message
        }`
      );
    }

    return slot;
  });

  const parsedRetiredObjects = requiredArrayField(
    value,
    "retiredObjects",
    "S3 retention response plan must include retiredObjects"
  ).map((retiredObject, index) =>
    assertRetiredObject(
      retiredObject,
      `S3 retention response plan.retiredObjects[${index}]`
    )
  );

  if (value.cursor !== undefined) {
    if (!isRecord(value.cursor)) {
      throw new Error("S3 retention response plan cursor must be an object");
    }

    assertCursor(value.cursor);
  }

  return {
    expiredSlots: parsedExpiredSlots,
    retiredObjects: parsedRetiredObjects,
    ...(value.cursor === undefined ? {} : { cursor: value.cursor }),
  };
}

function retentionResult(
  value: unknown
): StoredS3CoordinatorRetentionResponse["result"] {
  const record = requiredRecord(
    value,
    "S3 retention response must include result and summary"
  );
  const deletedObjects = requiredArrayField(
    record,
    "deletedObjects",
    "S3 retention response result must include deletedObjects"
  );
  const failedObjects = requiredArrayField(
    record,
    "failedObjects",
    "S3 retention response result must include failedObjects"
  );

  const parsedDeletedObjects = deletedObjects.map((entry, index) =>
    assertRetiredObject(
      entry,
      `S3 retention response result.deletedObjects[${index}]`
    )
  );

  const parsedFailedObjects = failedObjects.map((entry, index) => {
    const failure = requiredRecord(
      entry,
      `S3 retention response result.failedObjects[${index}] must be an object`
    );

    const object = assertRetiredObject(
      failure.object,
      `S3 retention response result.failedObjects[${index}].object`
    );

    return {
      error: requiredStringField(
        failure,
        "error",
        `S3 retention response result.failedObjects[${index}].error must be set`
      ),
      object,
    };
  });

  return {
    deletedObjects: parsedDeletedObjects,
    failedObjects: parsedFailedObjects,
  };
}

function retentionSummary(
  value: Record<string, unknown>
): StoredS3CoordinatorRetentionResponse["summary"] {
  const deleted = requiredSummaryNumber(
    value,
    "deleted",
    "S3 retention response summary must include deleted"
  );
  const failed = requiredSummaryNumber(
    value,
    "failed",
    "S3 retention response summary must include failed"
  );
  const planned = requiredSummaryNumber(
    value,
    "planned",
    "S3 retention response summary must include planned"
  );
  const failedObjectKeys = stringArrayField(
    value,
    "failedObjectKeys",
    "S3 retention response summary must include failedObjectKeys"
  );
  const failedSlotIds = stringArrayField(
    value,
    "failedSlotIds",
    "S3 retention response summary must include failedSlotIds"
  );
  const ok = requiredSummaryBoolean(
    value,
    "ok",
    "S3 retention response summary must include ok"
  );

  return {
    deleted,
    failed,
    failedObjectKeys,
    failedSlotIds,
    ok,
    planned,
  };
}

function summaryPayload(
  value: Record<string, unknown>
): StoredS3CoordinatorReconciliationResponse["summary"] {
  const committed = requiredSummaryNumber(
    value,
    "committed",
    "S3 reconciliation response summary must include committed"
  );
  const failed = requiredSummaryNumber(
    value,
    "failed",
    "S3 reconciliation response summary must include failed"
  );
  const idempotent = requiredSummaryNumber(
    value,
    "idempotent",
    "S3 reconciliation response summary must include idempotent"
  );
  const planned = requiredSummaryNumber(
    value,
    "planned",
    "S3 reconciliation response summary must include planned"
  );
  const status = requiredStringField(
    value,
    "status",
    "S3 reconciliation response summary must include status"
  );

  if (status !== "reconciled") {
    throw new Error(
      "S3 reconciliation response summary status must be reconciled"
    );
  }

  const failedErrorCodes = stringArrayField(
    value,
    "failedErrorCodes",
    "S3 reconciliation response summary must include failedErrorCodes"
  ) as readonly OlosErrorCode[];
  const failedSlotIds = stringArrayField(
    value,
    "failedSlotIds",
    "S3 reconciliation response summary must include failedSlotIds"
  );
  const slotIds = stringArrayField(
    value,
    "slotIds",
    "S3 reconciliation response summary must include slotIds"
  );
  const ok = requiredSummaryBoolean(
    value,
    "ok",
    "S3 reconciliation response summary must include ok"
  );

  return {
    committed,
    failed,
    failedErrorCodes,
    failedSlotIds,
    idempotent,
    ok,
    planned,
    slotIds,
    status,
  };
}

function assertRetiredObject(
  value: unknown,
  context: string
): {
  commitId: string;
  objectKey: string;
  slotId: string;
} {
  const retired = requiredRecord(value, `${context} must be an object`);

  return {
    commitId: requiredStringField(
      retired,
      "commitId",
      `${context}.commitId must be set`
    ),
    objectKey: requiredStringField(
      retired,
      "objectKey",
      `${context}.objectKey must be set`
    ),
    slotId: requiredStringField(
      retired,
      "slotId",
      `${context}.slotId must be set`
    ),
  };
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

function stringArrayField(
  value: Record<string, unknown>,
  field: string,
  message: string
): readonly string[] {
  const values = requiredArrayField(value, field, message);

  for (const [index, item] of values.entries()) {
    if (typeof item !== "string") {
      throw new Error(`${message}[${index}] must be a string`);
    }
  }

  return values as readonly OlosErrorCode[];
}
