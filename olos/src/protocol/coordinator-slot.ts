import {
  createPublisherDeliveryUrl,
  createPublisherObjectKey,
  type DerivableMediaObjectKind,
} from "../state/object-key-derivation";
import { createRuntimePublisherObjectKeyNonce } from "../state/object-key-nonce";
import { assertPublicationAllowed } from "../state/publication-control";
import { createIssuedUploadSlot } from "../state/upload-slot";
import {
  canTransitionUploadSlot,
  revokeUpload,
} from "../state/upload-slot-observe";
import type {
  CommittedSegment,
  RenditionWindow,
} from "../types/committed-window";
import { createOlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { MediaObjectKind } from "../types/media-object";
import type { UploadSlot } from "../types/upload-slot";
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

/**
 * Issue an upload slot for an init, part, or segment object and return the
 * next pipeline state with the slot appended. Pure function on state —
 * persisting the result is the caller's job.
 *
 * The slot's `objectKey` and `deliveryUrl` are derived from the state's
 * `mediaBaseUrl` plus the slot coordinates (rendition, media sequence, part
 * number); in `"direct-public"` publication mode a random nonce is mixed in
 * when `objectKeyNonce` is not supplied, making keys unguessable. Throws on
 * a duplicate `slotId`, a media object kind whose key cannot be derived, or
 * a publication control policy that blocks slot issuance.
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
  if (!isDerivableMediaObjectKind(options.kind)) {
    throw new Error(
      `cannot derive objectKey for media object kind ${options.kind}`
    );
  }

  const objectKey = createPublisherObjectKey({
    extension: options.extension,
    kind: options.kind,
    mediaSequenceNumber: options.mediaSequenceNumber,
    objectKeyNonce: resolveSlotObjectKeyNonce(options),
    objectKeyPrefix: options.objectKeyPrefix,
    partNumber: options.partNumber,
    renditionId: options.renditionId,
  });
  const deliveryUrl = createPublisherDeliveryUrl(
    options.state.mediaBaseUrl,
    objectKey
  );

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
