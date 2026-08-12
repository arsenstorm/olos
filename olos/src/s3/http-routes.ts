import { rejectionStatusCode } from "../runtime/rejection-status";
import { jsonBadRequestResponse, jsonResponse } from "../runtime/response";
import { parseSlotIssueRequest } from "../runtime/slot-issue-request-parser";
import { createOlosError } from "../types/errors";
import { errorMessage } from "../validation/fields";
import { completeStoredS3CoordinatorUpload } from "./coordinator-event";
import { issueStoredS3CoordinatorUploadGrant } from "./coordinator-grant";
import { invalid, type StoredS3CoordinatorRuntimeHandlerContext } from "./http";
import {
  parseS3CommitRequest,
  parseS3CompletionHintRequest,
} from "./http-request-parser";
import { s3ResponseConflict, s3ResponseNotFound } from "./http-response";
import {
  s3CommitResponse,
  scheduleRetiredObjectDeletes,
} from "./http-routes-events";
import type {
  CreateStoredS3CoordinatorRuntimeHandlerOptions,
  StoredS3CoordinatorSlotGrantResponse,
} from "./http-types";
import type { S3HeadObjectClient } from "./object-observation";

export async function handleS3SlotGrant(
  request: Request,
  sessionId: string,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): Promise<Response> {
  const parsed = await parseSlotIssueRequest(
    request,
    invalid,
    "invalid S3 slot grant request",
    "S3 slot grant request"
  );

  if (parsed.status === "invalid") {
    return jsonBadRequestResponse(parsed.message);
  }

  const result = await issueStoredS3CoordinatorUploadGrant({
    ...parsed.value,
    additionalHeaders: options.additionalHeaders,
    bucket: options.bucket,
    client: options.client,
    expiresInSeconds: options.expiresInSeconds,
    maxAttempts: options.maxAttempts,
    now: options.grantNow?.(),
    publicationControl: options.publicationControl,
    sessionId,
    store: options.store,
  });

  if (result.status === "saved") {
    const body: StoredS3CoordinatorSlotGrantResponse = {
      grant: result.grant,
      slot: result.slot,
    };

    return jsonResponse(body, 201);
  }

  if (result.status === "not_found") {
    return s3ResponseNotFound();
  }

  if (result.status === "rejected") {
    return jsonResponse(
      result.error,
      rejectionStatusCode(result.error.error.code)
    );
  }

  return s3ResponseConflict();
}

export async function handleS3Commit(
  request: Request,
  sessionId: string,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions,
  ctx: StoredS3CoordinatorRuntimeHandlerContext | undefined
): Promise<Response> {
  const parsed = await parseS3CommitRequest(request, options);

  if (parsed.status === "invalid") {
    return jsonBadRequestResponse(parsed.message);
  }

  const result = await completeStoredS3CoordinatorUpload({
    ...parsed.payload,
    bucket: options.bucket,
    client: options.objectClient ?? options.client,
    commitPolicy: options.commitPolicy,
    maxAttempts: options.maxAttempts,
    publicationControl: options.publicationControl,
    sessionId,
    store: options.store,
  });

  await scheduleRetiredObjectDeletes(result, options, ctx);
  return s3CommitResponse(result, options);
}

export async function handleS3CompletionHint(
  request: Request,
  route: { sessionId: string; slotId: string },
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions,
  ctx: StoredS3CoordinatorRuntimeHandlerContext | undefined
): Promise<Response> {
  const { sessionId, slotId } = route;
  const parsed = await parseS3CompletionHintRequest(request, options, slotId);

  if (parsed.status === "invalid") {
    return jsonBadRequestResponse(parsed.message);
  }

  let result: Awaited<ReturnType<typeof completeStoredS3CoordinatorUpload>>;

  try {
    result = await completeStoredS3CoordinatorUpload({
      ...parsed.payload,
      bucket: options.bucket,
      client: tagCompletionHintObservationFailures(
        options.objectClient ?? options.client
      ),
      commitPolicy: options.commitPolicy,
      maxAttempts: options.maxAttempts,
      publicationControl: options.publicationControl,
      sessionId,
      store: options.store,
    });
  } catch (error) {
    if (error instanceof S3CompletionHintObservationError) {
      return completionHintNotObservedResponse(error);
    }

    throw error;
  }

  await scheduleRetiredObjectDeletes(result, options, ctx);
  return s3CommitResponse(result, options);
}

/**
 * Marks `HeadObject` failures raised while verifying a completion hint.
 * Only these map to the hint's "not yet observed" error envelope; any other
 * throw (store I/O, a corrupt snapshot) still reaches the handler's opaque
 * 500 guard.
 */
class S3CompletionHintObservationError extends Error {
  constructor(cause: unknown) {
    super(errorMessage(cause, "completion hint object was not observed"));
    this.name = "S3CompletionHintObservationError";
  }
}

// Spec §7.9: a completion hint is not proof — the uploaded object may not
// be visible to `HeadObject` yet, so a failed observation on the hint path
// is an expected outcome, not an internal error. Tag observation failures
// at the client boundary so the route can tell them apart from store I/O.
function tagCompletionHintObservationFailures(
  client: S3HeadObjectClient
): S3HeadObjectClient {
  return {
    async send(command) {
      try {
        return await client.send(command);
      } catch (error) {
        throw new S3CompletionHintObservationError(error);
      }
    },
  };
}

// The slot stays uncommitted awaiting object proof; report the failed
// observation in the reconciliation routes' failed-record style
// (`olos.invalid_state` with the observation failure's message) so the
// publisher can retry the hint or leave it to events/reconciliation.
function completionHintNotObservedResponse(
  error: S3CompletionHintObservationError
): Response {
  return jsonResponse(
    createOlosError("olos.invalid_state", error.message),
    rejectionStatusCode("olos.invalid_state")
  );
}

// Drop the storage-side objects for commits the state machine pruned. When
// a waitUntil-capable context is supplied (Cloudflare Workers), the deletes
// run after the response goes out so SigV4 signing CPU stays outside the
// request budget — required on Workers Free's ~10 ms cap. Without a ctx,
// the deletes await inline (correct, just costs request CPU; that's the
// path tests and non-CF runtimes take).
