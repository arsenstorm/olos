import type { OlosError } from "../types/errors";

/** All operations a {@link PublicationControlPolicy} can disable. */
export const PUBLICATION_CONTROL_OPERATIONS = [
  "issue_slot",
  "commit_upload",
  "process_provider_event",
  "advance_cursor",
] as const;

/** A publication pipeline operation subject to control policies. */
export type PublicationControlOperation =
  (typeof PUBLICATION_CONTROL_OPERATIONS)[number];

/** Policy disabling selected publication operations (e.g. a kill switch). */
export interface PublicationControlPolicy {
  /** Operations to block; anything not listed stays allowed. */
  disabledOperations?: readonly PublicationControlOperation[];
  /** Human-readable explanation included in blocked-operation errors. */
  reason?: string;
}

/** Outcome of {@link resolvePublicationControl}. */
export type PublicationControlResolution =
  | { status: "allowed" }
  | {
      error: OlosError;
      operation: PublicationControlOperation;
      status: "blocked";
    };

/** Options for {@link resolvePublicationControl}. */
export interface ResolvePublicationControlOptions {
  operation: PublicationControlOperation;
  /** Active control policy; omitting it allows every operation. */
  policy?: PublicationControlPolicy;
}

/**
 * Build a policy that disables every publication operation, optionally
 * recording the reason surfaced in blocked-operation errors. Pure.
 */
export function createPublicationKillSwitch(
  reason?: string
): PublicationControlPolicy {
  return {
    disabledOperations: PUBLICATION_CONTROL_OPERATIONS,
    ...(reason === undefined ? {} : { reason }),
  };
}

/**
 * Check an operation against the control policy. Returns `allowed` when
 * no policy is given or the operation is not disabled; otherwise
 * `blocked` with an `olos.security_policy_violation` error carrying the
 * policy's reason. Pure.
 */
export function resolvePublicationControl(
  options: ResolvePublicationControlOptions
): PublicationControlResolution {
  if (!isPublicationOperationDisabled(options)) {
    return { status: "allowed" };
  }

  return {
    error: publicationControlError(options),
    operation: options.operation,
    status: "blocked",
  };
}

/**
 * Throwing variant of {@link resolvePublicationControl}: throws an
 * `Error` when the operation is blocked, returns nothing otherwise.
 */
export function assertPublicationAllowed(
  options: ResolvePublicationControlOptions
): void {
  const resolution = resolvePublicationControl(options);

  if (resolution.status === "blocked") {
    throw new Error(resolution.error.error.message);
  }
}

function publicationControlError(
  options: ResolvePublicationControlOptions
): OlosError {
  return {
    error: {
      code: "olos.security_policy_violation",
      details: {
        operation: options.operation,
        ...publicationControlReasonDetails(options.policy),
      },
      message: "publication operation is disabled",
    },
  };
}

function isPublicationOperationDisabled(
  options: ResolvePublicationControlOptions
): boolean {
  return (
    options.policy?.disabledOperations?.includes(options.operation) === true
  );
}

function publicationControlReasonDetails(
  policy: PublicationControlPolicy | undefined
): { reason?: string } {
  return policy?.reason === undefined ? {} : { reason: policy.reason };
}
