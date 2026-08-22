import {
  createPublisherDeliveryUrl,
  createPublisherObjectKey,
  type DerivableObjectKind,
} from "../state/object-key-derivation";
import { createRuntimePublisherObjectKeyNonce } from "../state/object-key-nonce";
import { assertPublicationAllowed } from "../state/publication-control";
import { createIssuedUploadSlot } from "../state/upload-slot";
import {
  canTransitionUploadSlot,
  revokeUpload,
} from "../state/upload-slot-observe";
import type { CommittedSegment, TrackWindow } from "../types/committed-window";
import { createOlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { ObjectKind } from "../types/storage-object";
import type { UploadSlot, UploadSlotState } from "../types/upload-slot";
import type {
  CoordinatorPipelineState,
  CoordinatorSlotIssue,
  CoordinatorUploadRevocation,
  IssueCoordinatorSlotOptions,
  RevokeCoordinatorUploadOptions,
} from "./coordinator-types";

type RevocableCoordinatorUpload =
  | Extract<CoordinatorUploadRevocation, { status: "rejected" }>
  | {
      slot: UploadSlot;
      status: "revocable";
    };

// A slot in any of these states still occupies its track/kind/sequence/part
// position: an issued grant not yet resolved, an observed upload awaiting
// commit, or a commit already recorded. Only a slot that failed out
// (expired, rejected, revoked) frees the position for reissue.
const OPEN_UPLOAD_SLOT_STATES: readonly UploadSlotState[] = [
  "issued",
  "upload_observed",
  "committed",
];

/**
 * Issue an upload slot for an init, part, or segment object and return the
 * next pipeline state with the slot appended. Pure function on state —
 * persisting the result is the caller's job.
 *
 * The slot's `objectKey` and `deliveryUrl` are derived from the state's
 * `deliveryBaseUrl` plus the slot coordinates (track, sequence number, part
 * number); in `"direct-public"` publication mode a random nonce is mixed in
 * when `objectKeyNonce` is not supplied, making keys unguessable. Throws on
 * a duplicate `slotId`, an open slot already occupying the same
 * track/kind/sequence-number/part-number position, an object kind whose key
 * cannot be derived, or a publication control policy that blocks slot
 * issuance.
 */
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

  if (findOpenSlotAtPosition(options.state, options) !== undefined) {
    throw new Error("an open slot already exists for this position");
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

function findOpenSlotAtPosition(
  state: CoordinatorPipelineState,
  options: IssueCoordinatorSlotOptions
): UploadSlot | undefined {
  return state.slots.find(
    (slot) =>
      slot.trackId === options.trackId &&
      slot.kind === options.kind &&
      slot.sequenceNumber === options.sequenceNumber &&
      slot.partNumber === options.partNumber &&
      OPEN_UPLOAD_SLOT_STATES.includes(slot.state)
  );
}

function resolveSlotObjectAddress(options: IssueCoordinatorSlotOptions): {
  objectKey: string;
  deliveryUrl: string;
} {
  if (!isDerivableObjectKind(options.kind)) {
    throw new Error(`cannot derive objectKey for object kind ${options.kind}`);
  }

  const objectKey = createPublisherObjectKey({
    extension: options.extension,
    kind: options.kind,
    sequenceNumber: options.sequenceNumber,
    objectKeyNonce: resolveSlotObjectKeyNonce(options),
    objectKeyPrefix: options.objectKeyPrefix,
    partNumber: options.partNumber,
    trackId: options.trackId,
  });
  const deliveryUrl = createPublisherDeliveryUrl(
    options.state.deliveryBaseUrl,
    objectKey
  );

  return { deliveryUrl, objectKey };
}

function isDerivableObjectKind(kind: ObjectKind): kind is DerivableObjectKind {
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

/**
 * Revoke an upload slot and drop any commits recorded against it from the
 * returned state. Pure function on state — persisting the result is the
 * caller's job. Revoking an already-revoked slot is idempotent and reports
 * `"already_revoked"`.
 *
 * Rejects when the slot does not exist, when its current state cannot
 * transition to `"revoked"`, or when the slot is referenced by the live
 * cursor's committed window — content that players may already be fetching
 * must not silently disappear.
 */
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
      error: createOlosError("olos.unknown_slot", "upload slot was not found", {
        slotId: options.slotId,
      }),
      state: options.state,
      status: "rejected",
    };
  }

  const reason = revocationRefusal(options.state, slot);

  if (reason !== undefined) {
    return {
      error: createOlosError("olos.invalid_state", reason, {
        slotId: slot.slotId,
        state: slot.state,
      }),
      state: options.state,
      status: "rejected",
    };
  }

  return {
    slot,
    status: "revocable",
  };
}

/** Why this slot may not be silently revoked, or `undefined` if it may. */
function revocationRefusal(
  state: CoordinatorPipelineState,
  slot: UploadSlot
): string | undefined {
  if (isSlotInCursor(state, slot)) {
    return "upload slots reflected in the live cursor cannot be silently revoked";
  }

  if (
    slot.state !== "revoked" &&
    !canTransitionUploadSlot(slot.state, "revoked")
  ) {
    return "upload slot cannot be revoked from its current state";
  }

  return;
}

export function findSlot(
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

  return Object.values(cursor.committedWindow.tracks).some((track) =>
    cursorTrackContainsSlot(track, slot)
  );
}

function cursorTrackContainsSlot(
  track: TrackWindow,
  slot: UploadSlot
): boolean {
  return (
    track.init?.slotId === slot.slotId ||
    track.segments.some((segment) => cursorSegmentContainsSlot(segment, slot))
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
