import {
  createPublisherDeliveryUrl,
  createPublisherObjectKey,
  type DerivableMediaObjectKind,
} from "../state/object-key-derivation";
import { createRuntimePublisherObjectKeyNonce } from "../state/object-key-nonce";
import { assertPublicationAllowed } from "../state/publication-control";
import {
  canTransitionUploadSlot,
  createIssuedUploadSlot,
  revokeUpload,
} from "../state/upload-slot";
import type {
  CommittedSegment,
  RenditionWindow,
} from "../types/committed-window";
import type { OlosId } from "../types/ids";
import type { MediaObjectKind } from "../types/media-object";
import type { UploadSlot } from "../types/upload-slot";
import type {
  CoordinatorPipelineState,
  CoordinatorSlotIssue,
  CoordinatorUploadRevocation,
  IssueCoordinatorSlotOptions,
  RevokeCoordinatorUploadOptions,
} from "./coordinator";
import { coordinatorError } from "./coordinator-error";

type RevocableCoordinatorUpload =
  | Extract<CoordinatorUploadRevocation, { status: "rejected" }>
  | {
      slot: UploadSlot;
      status: "revocable";
    };

export function issueCoordinatorSlot(
  options: IssueCoordinatorSlotOptions
): CoordinatorSlotIssue {
  assertPublicationAllowed({
    operation: "issue_slot",
    policy: options.publicationControl,
  });

  if (findSlot(options.state, options.slotId) !== undefined) {
    throw new Error("slotId must be unique");
  }

  const { objectKey, deliveryUrl } = resolveSlotObjectAddress(options);
  const slot = createIssuedUploadSlot({
    ...options,
    deliveryUrl,
    objectKey,
    session: options.state.session,
  });

  return {
    slot,
    state: {
      ...options.state,
      slots: [...options.state.slots, slot],
    },
  };
}

function resolveSlotObjectAddress(options: IssueCoordinatorSlotOptions): {
  objectKey: string;
  deliveryUrl: string;
} {
  if (options.objectKey !== undefined && options.deliveryUrl !== undefined) {
    return { deliveryUrl: options.deliveryUrl, objectKey: options.objectKey };
  }

  if (!isDerivableMediaObjectKind(options.kind)) {
    throw new Error(
      `cannot derive objectKey for media object kind ${options.kind}`
    );
  }

  const nonce = resolveSlotObjectKeyNonce(options);
  const objectKey =
    options.objectKey ??
    createPublisherObjectKey({
      ...(options.extension === undefined
        ? {}
        : { extension: options.extension }),
      kind: options.kind,
      mediaSequenceNumber: options.mediaSequenceNumber,
      ...(nonce === undefined ? {} : { objectKeyNonce: nonce }),
      ...(options.objectKeyPrefix === undefined
        ? {}
        : { objectKeyPrefix: options.objectKeyPrefix }),
      ...(options.partNumber === undefined
        ? {}
        : { partNumber: options.partNumber }),
      renditionId: options.renditionId,
    });
  const deliveryUrl =
    options.deliveryUrl ??
    createPublisherDeliveryUrl(options.state.mediaBaseUrl, objectKey);

  return { deliveryUrl, objectKey };
}

function isDerivableMediaObjectKind(
  kind: MediaObjectKind
): kind is DerivableMediaObjectKind {
  return kind === "init" || kind === "part" || kind === "segment";
}

function resolveSlotObjectKeyNonce(
  options: IssueCoordinatorSlotOptions
): string | undefined {
  if (options.objectKeyNonce !== undefined) {
    return options.objectKeyNonce;
  }

  const publicationMode = options.state.publicationMode ?? "direct-public";

  if (publicationMode !== "direct-public") {
    return;
  }

  return createRuntimePublisherObjectKeyNonce({
    bytes: crypto.getRandomValues(new Uint8Array(16)),
  });
}

export function revokeCoordinatorUpload(
  options: RevokeCoordinatorUploadOptions
): CoordinatorUploadRevocation {
  const revocation = resolveRevocableCoordinatorUpload(options);

  if (revocation.status === "rejected") {
    return revocation;
  }

  const result = revokeUpload({ slot: revocation.slot });

  return {
    slot: result,
    state: removeSlotCommit({
      slot: result,
      state: options.state,
    }),
    status: revocation.slot.state === "revoked" ? "already_revoked" : "revoked",
  };
}

function resolveRevocableCoordinatorUpload(
  options: RevokeCoordinatorUploadOptions
): RevocableCoordinatorUpload {
  const slot = findSlot(options.state, options.slotId);

  if (slot === undefined) {
    return {
      error: coordinatorError(
        "olos.unknown_slot",
        "upload slot was not found",
        {
          slotId: options.slotId,
        }
      ),
      state: options.state,
      status: "rejected",
    };
  }

  if (isSlotInCursor(options.state, slot)) {
    return {
      error: coordinatorError(
        "olos.invalid_state",
        "upload slots reflected in the live cursor cannot be silently revoked",
        { slotId: slot.slotId, state: slot.state }
      ),
      state: options.state,
      status: "rejected",
    };
  }

  if (
    slot.state !== "revoked" &&
    !canTransitionUploadSlot(slot.state, "revoked")
  ) {
    return {
      error: coordinatorError(
        "olos.invalid_state",
        "upload slot cannot be revoked from its current state",
        { slotId: slot.slotId, state: slot.state }
      ),
      state: options.state,
      status: "rejected",
    };
  }

  return {
    slot,
    status: "revocable",
  };
}

function findSlot(
  state: CoordinatorPipelineState,
  slotId: OlosId
): UploadSlot | undefined {
  return state.slots.find((slot) => slot.slotId === slotId);
}

function isSlotInCursor(
  state: CoordinatorPipelineState,
  slot: UploadSlot
): boolean {
  const cursor = state.cursor;

  if (cursor === undefined) {
    return false;
  }

  return Object.values(cursor.committedWindow.renditions).some((rendition) =>
    cursorRenditionContainsSlot(rendition, slot)
  );
}

function cursorRenditionContainsSlot(
  rendition: RenditionWindow,
  slot: UploadSlot
): boolean {
  return (
    rendition.init.slotId === slot.slotId ||
    rendition.segments.some((segment) =>
      cursorSegmentContainsSlot(segment, slot)
    )
  );
}

function cursorSegmentContainsSlot(
  segment: CommittedSegment,
  slot: UploadSlot
): boolean {
  return (
    segment.segment?.slotId === slot.slotId ||
    segment.parts?.some((part) => part.slotId === slot.slotId) === true
  );
}

function removeSlotCommit(options: {
  slot: UploadSlot;
  state: CoordinatorPipelineState;
}): CoordinatorPipelineState {
  return {
    ...options.state,
    commits: options.state.commits.filter(
      (commit) => commit.slotId !== options.slot.slotId
    ),
    initCommits: options.state.initCommits.filter(
      (commit) => commit.slotId !== options.slot.slotId
    ),
    slots: options.state.slots.map((slot) =>
      slot.slotId === options.slot.slotId ? options.slot : slot
    ),
  };
}
