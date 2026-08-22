import { sessionNotFound } from "../runtime/http-parse";
import { rejectionStatusCode } from "../runtime/rejection-status";
import {
  jsonBadRequestResponse,
  jsonErrorResponse,
  jsonResponse,
} from "../runtime/response";
import { parseSlotIssueRequest } from "../runtime/slot-issue-payload";
import { createOlosError } from "../types/errors";
import { completeStoredS3CoordinatorUpload } from "./coordinator-event";
import {
  issueStoredS3CoordinatorUploadGrant,
  S3SlotIssueError,
} from "./coordinator-grant";
import type { StoredS3CoordinatorRuntimeHandlerContext } from "./http";
import {
  invalid,
  parseS3CommitRequest,
  parseS3CompletionHintRequest,
} from "./http-request-parser";
import { s3ResponseConflict } from "./http-response";
import {
  s3CommitResponse,
  scheduleRetiredObjectDeletes,
} from "./http-routes-events";
import type {
  CreateStoredS3CoordinatorRuntimeHandlerOptions,
  StoredS3CoordinatorSlotGrantResponse,
} from "./http-types";
import type { S3HeadObjectClient } from "./object-observation";

/**
 * Turn an invalid S3 request parse into its response: 413
 * `olos.invalid_request` when the body exceeded `maxBodyBytes`, otherwise
 * the usual 400.
 */
export function invalidS3RequestResponse(parsed: {
  message: string;
  tooLarge?: true;
}): Response {
  return parsed.tooLarge
    ? jsonErrorResponse("olos.invalid_request", parsed.message, 413)
    : jsonBadRequestResponse(parsed.message);
}

export async function handleS3SlotGrant(
  request: Request,
  sessionId: string,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): Promise<Response> {
  const parsed = await parseSlotIssueRequest(
    request,
    invalid,
    "invalid S3 slot grant request",
    "S3 slot grant request",
    options.maxBodyBytes
  );

  if (parsed.status === "invalid") {
    return invalidS3RequestResponse(parsed);
  }

  try {
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

    return slotGrantResponse(result);
  } catch (error) {
    if (!(error instanceof S3SlotIssueError)) {
      throw error;
    }
    return jsonBadRequestResponse(error.message);
  }
}

function slotGrantResponse(
  result: Awaited<ReturnType<typeof issueStoredS3CoordinatorUploadGrant>>
): Response {
  if (result.status === "saved") {
    const body: StoredS3CoordinatorSlotGrantResponse = {
      grant: result.grant,
      slot: result.slot,
    };

    return jsonResponse(body, 201);
  }

  if (result.status === "not_found") {
    return sessionNotFound();
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
    return invalidS3RequestResponse(parsed);
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
    return invalidS3RequestResponse(parsed);
  }

  const result = await completeStoredS3CoordinatorUpload({
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
  }).catch((error: unknown) =>
    completionHintNotObservedOrRethrow(error, { options, sessionId, slotId })
  );

  if (result instanceof Response) {
    return result;
  }

  await scheduleRetiredObjectDeletes(result, options, ctx);
  return s3CommitResponse(result, options);
}

function completionHintNotObservedOrRethrow(
  error: unknown,
  context: {
    options: CreateStoredS3CoordinatorRuntimeHandlerOptions;
    sessionId: string;
    slotId: string;
  }
): Response {
  if (!(error instanceof S3CompletionHintObservationError)) {
    throw error;
  }

  context.options.onError?.(error.cause, {
    route: "completion_hint",
    sessionId: context.sessionId,
  });
  return completionHintNotObservedResponse(context.slotId);
}

/**
 * Marks `HeadObject` failures raised while verifying a completion hint.
 * Only these map to the hint's "not yet observed" error envelope; any other
 * throw (store I/O, a corrupt snapshot) still reaches the handler's opaque
 * 500 guard. The SDK error is kept as `cause` for `onError`; the HTTP
 * response never surfaces its message.
 */
class S3CompletionHintObservationError extends Error {
  constructor(cause: unknown) {
    super("completion hint object was not observed", { cause });
    this.name = "S3CompletionHintObservationError";
  }
}

// Spec §7.9: a hint is not proof — the object may not be visible to
// `HeadObject` yet, so a failed observation is expected, not internal.
// Tagging at the client boundary separates it from store I/O failures.
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

// The slot stays uncommitted awaiting proof; `olos.invalid_state` matches
// the reconciliation routes' failed-record style so the publisher can
// retry the hint or leave it to events/reconciliation. The message is fixed
// rather than the SDK's — it never reaches the response body.
function completionHintNotObservedResponse(slotId: string): Response {
  return jsonResponse(
    createOlosError(
      "olos.invalid_state",
      "completion hint object is not yet observable",
      { slotId }
    ),
    rejectionStatusCode("olos.invalid_state")
  );
}

// With a waitUntil-capable ctx (Cloudflare Workers) the deletes run after
// the response so SigV4 signing CPU stays outside the request budget —
// required on Workers Free's ~10 ms cap. Without a ctx they await inline.
