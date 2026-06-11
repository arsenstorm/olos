import type { OlosError } from "../types/errors";

export const PUBLICATION_CONTROL_OPERATIONS = [
  "issue_slot",
  "commit_upload",
  "process_provider_event",
  "advance_cursor",
] as const;

export type PublicationControlOperation =
  (typeof PUBLICATION_CONTROL_OPERATIONS)[number];

export interface PublicationControlPolicy {
  disabledOperations?: readonly PublicationControlOperation[];
  reason?: string;
}

export type PublicationControlResolution =
  | { status: "allowed" }
  | {
      error: OlosError;
      operation: PublicationControlOperation;
      status: "blocked";
    };

export interface ResolvePublicationControlOptions {
  operation: PublicationControlOperation;
  policy?: PublicationControlPolicy;
}

export function createPublicationKillSwitch(
  reason?: string
): PublicationControlPolicy {
  return {
    disabledOperations: PUBLICATION_CONTROL_OPERATIONS,
    ...(reason === undefined ? {} : { reason }),
  };
}

export function resolvePublicationControl(
  options: ResolvePublicationControlOptions
): PublicationControlResolution {
  if (!options.policy?.disabledOperations?.includes(options.operation)) {
    return { status: "allowed" };
  }

  return {
    error: publicationControlError(options),
    operation: options.operation,
    status: "blocked",
  };
}

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
        ...(options.policy?.reason === undefined
          ? {}
          : { reason: options.policy.reason }),
      },
      message: "publication operation is disabled",
    },
  };
}
