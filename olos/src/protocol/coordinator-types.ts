import type { CreateCommittedWindowOptions } from "../state/committed-window";
import type { PublicationControlPolicy } from "../state/publication-control";
import type { RetiredCommittedObject } from "../state/retention";
import type { CreateIssuedUploadSlotOptions } from "../state/upload-slot";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { OlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { ProfileData } from "../types/profile";
import type { PublicationMode } from "../types/publication";
import type { Session } from "../types/session";
import type { UploadSlot } from "../types/upload-slot";
import type { ObservedUpload } from "../validation/observed-upload";

/**
 * Record of a publisher instance's exclusive claim on a session, persisted in
 * coordinator state so competing publishers can detect an active holder.
 */
export interface CoordinatorPublisherLease {
  /** ISO timestamp after which the lease may be taken over. */
  expiresAt: string;
  issuedAt: string;
  /** ISO timestamp of the holder's latest heartbeat; renewals bump this. */
  lastSeenAt: string;
  publisherInstanceId: OlosId;
  sessionId: OlosId;
}

/**
 * Complete coordinator-side state of one streaming session: the session
 * descriptor, issued upload slots, recorded commits, and the live cursor.
 * Treated as an immutable value — coordinator operations return a new state
 * rather than mutating the input.
 */
export interface CoordinatorPipelineState {
  /** Segment and part commits; init commits live in `initCommits`. */
  commits: readonly Commit[];
  /** Live cursor; absent until the first contiguous commit lands. */
  cursor?: Cursor;
  /** Base delivery URL that slot `deliveryUrl`s are derived from. */
  deliveryBaseUrl: string;
  initCommits: readonly Commit[];
  /** Defaults to `"direct-public"` when absent. */
  publicationMode?: PublicationMode;
  publisherLeases: readonly CoordinatorPublisherLease[];
  session: Session;
  slots: readonly UploadSlot[];
}

/**
 * A persisted coordinator state together with the store etag that versions
 * it. The etag feeds optimistic-concurrency saves via `expectedEtag`.
 */
export interface CoordinatorPipelineSnapshot {
  etag: string;
  state: CoordinatorPipelineState;
}

/**
 * Read-optimized projection of a snapshot: just the session, the cursor, and
 * the etag. Serving manifest reads from this view lets stores skip parsing
 * the full snapshot (see `CoordinatorPipelineStore.loadCursor`).
 */
export interface CoordinatorCursorView {
  cursor?: Cursor;
  etag: string;
  session: Session;
}

/** Options for `createCoordinatorPipeline`. */
export interface CreateCoordinatorPipelineOptions {
  /** Base delivery URL that slot `deliveryUrl`s are derived from. */
  deliveryBaseUrl: string;
  /** Defaults to `"direct-public"`. */
  publicationMode?: PublicationMode;
  session: Session;
}

/**
 * Persistence contract for coordinator pipeline snapshots, keyed by session
 * id, with etag-based optimistic concurrency on save. Implementations must
 * satisfy `assertCoordinatorPipelineStoreConformance` from
 * `olos/conformance`.
 */
export interface CoordinatorPipelineStore {
  load(sessionId: OlosId): Promise<CoordinatorPipelineSnapshot | undefined>;
  /**
   * Optional fast path for manifest reads: returns only the cursor view so
   * implementations can avoid loading and parsing the full snapshot.
   */
  loadCursor?(sessionId: OlosId): Promise<CoordinatorCursorView | undefined>;
  save(options: SaveCoordinatorPipelineOptions): Promise<CoordinatorStoreSave>;
}

/** Options for `CoordinatorPipelineStore.save`. */
export interface SaveCoordinatorPipelineOptions {
  /**
   * Etag of the snapshot the caller loaded. Omit to insert a new session —
   * inserting over an existing record conflicts, as does an etag that no
   * longer matches the stored record (or a session that does not exist).
   */
  expectedEtag?: string;
  sessionId: OlosId;
  state: CoordinatorPipelineState;
}

/**
 * Result of `CoordinatorPipelineStore.save`: `"saved"` carries the newly
 * assigned etag; `"conflict"` means the optimistic check failed and carries
 * the winning snapshot when the store can provide it (absent when the
 * session record is missing entirely).
 */
export type CoordinatorStoreSave =
  | {
      etag: string;
      state: CoordinatorPipelineState;
      status: "saved";
    }
  | {
      current?: CoordinatorPipelineSnapshot;
      status: "conflict";
    };

/** Options for `mutateCoordinatorPipeline`. */
export interface MutateCoordinatorPipelineOptions {
  /**
   * Total load-mutate-save attempts before giving up with `"conflict"`.
   * Must be a positive integer; defaults to 2.
   */
  maxAttempts?: number;
  /**
   * Pure state transition; must return a new state rather than mutating the
   * input. May run more than once when a save conflict triggers a retry, so
   * external side effects should be avoided.
   */
  mutate(
    state: CoordinatorPipelineState
  ): CoordinatorPipelineState | Promise<CoordinatorPipelineState>;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

/**
 * Result of `mutateCoordinatorPipeline`: `"saved"` carries the persisted
 * state and its new etag; `"conflict"` means retries were exhausted (with
 * the last-seen snapshot in `current` when available); `"not_found"` means
 * no snapshot exists for the session.
 */
export type CoordinatorPipelineMutation =
  | {
      etag: string;
      state: CoordinatorPipelineState;
      status: "saved";
    }
  | {
      current?: CoordinatorPipelineSnapshot;
      status: "conflict";
    }
  | {
      status: "not_found";
    };

/**
 * Options for `issueCoordinatorSlot`. Extends the slot descriptor fields with
 * the pipeline state; `objectKey` and `deliveryUrl` are derived from the
 * state's `deliveryBaseUrl` rather than passed in.
 */
export interface IssueCoordinatorSlotOptions
  extends Omit<
    CreateIssuedUploadSlotOptions,
    "deliveryUrl" | "objectKey" | "session"
  > {
  /** File extension for the derived object key (e.g. `"mp4"`). */
  extension?: string;
  /**
   * Explicit nonce mixed into the derived object key. When omitted in
   * `"direct-public"` publication mode a random nonce is generated so object
   * keys are unguessable; other modes derive deterministic keys.
   */
  objectKeyNonce?: string;
  /** Prefix prepended to the derived object key. */
  objectKeyPrefix?: string;
  /** Policy gate consulted before issuing; blocked policies throw. */
  publicationControl?: PublicationControlPolicy;
  state: CoordinatorPipelineState;
}

/** Result of `issueCoordinatorSlot`: the issued slot and the next state. */
export interface CoordinatorSlotIssue {
  slot: UploadSlot;
  state: CoordinatorPipelineState;
}

/** Options for `commitCoordinatorUpload`. */
export interface CommitCoordinatorUploadOptions {
  commitId: OlosId;
  /** Extra acceptance gate evaluated before the commit is applied. */
  commitPolicy?: CoordinatorCommitPolicy;
  /** ISO timestamp of the commit attempt. */
  committedAt: string;
  /**
   * Grace period in milliseconds for uploads observed after the slot's
   * `expiresAt` before they are rejected as late.
   */
  lateToleranceMs?: number;
  /**
   * Cap on segments retained in the committed window; older commits are
   * retired (and surfaced as `retiredObjects`) once the window advances.
   */
  maxSegments?: number;
  /** The uploaded object as observed in storage. */
  object: ObservedUpload;
  /**
   * Profile data recorded on the commit (opaque to Core). Merged over the
   * slot's `profile`: slot keys first, commit keys win per key.
   */
  profile?: ProfileData;
  /** Policy gate for the commit and any resulting cursor advancement. */
  publicationControl?: PublicationControlPolicy;
  slotId: OlosId;
  state: CoordinatorPipelineState;
  /**
   * Profile hook producing each track window's `profile` when the cursor
   * advances; see `createCommittedWindow` (olos/state). Omit for none.
   */
  trackWindowProfile?: CreateCommittedWindowOptions["trackWindowProfile"];
}

/** Inputs a `CoordinatorCommitPolicy` sees for one commit attempt. */
export interface CoordinatorCommitPolicyContext {
  commitId: OlosId;
  committedAt: string;
  object: ObservedUpload;
  /**
   * The slot's `profile` merged with the request's, commit keys winning per
   * key — what the commit will record.
   */
  profile?: ProfileData;
  slot: UploadSlot;
  state: CoordinatorPipelineState;
}

/**
 * Verdict returned by a `CoordinatorCommitPolicy`; a rejection's error is
 * surfaced unchanged in the `"rejected"` commit result.
 */
export type CoordinatorCommitPolicyDecision =
  | { status: "allowed" }
  | {
      error: OlosError;
      status: "rejected";
    };

/**
 * Caller-supplied acceptance gate for `commitCoordinatorUpload`, evaluated
 * after built-in validation but before the commit mutates state. Runs only
 * when the slot exists and is not already committed.
 */
export type CoordinatorCommitPolicy = (
  context: CoordinatorCommitPolicyContext
) => CoordinatorCommitPolicyDecision;

/** Options for `revokeCoordinatorUpload`. */
export interface RevokeCoordinatorUploadOptions {
  slotId: OlosId;
  state: CoordinatorPipelineState;
}

/** Options for `planCoordinatorRetention`. */
export interface PlanCoordinatorRetentionOptions {
  /**
   * Grace period in milliseconds added to each slot's `expiresAt` before it
   * counts as expired; defaults to 0. Match it to the commit path's
   * `lateToleranceMs` so retention never prunes a slot whose late upload
   * would still commit.
   */
  lateToleranceMs?: number;
  /** ISO timestamp used to decide which issued slots have expired. */
  now: string;
  state: CoordinatorPipelineState;
}

/**
 * What retention would remove from a pipeline state: issued slots whose
 * grant expired without an upload, and committed objects that fell behind
 * the retained window. Produced by `planCoordinatorRetention`; the plan does
 * not modify state.
 */
export interface CoordinatorRetentionPlan {
  /** The cursor whose committed window anchored the plan, when one exists. */
  cursor?: Cursor;
  expiredSlots: readonly UploadSlot[];
  /** Commits safe to prune; callers should delete their backing objects. */
  retiredObjects: readonly RetiredCommittedObject[];
}

/**
 * Result of `commitCoordinatorUpload`. `"committed"` carries the next state
 * plus any objects retired by auto-retention; `"idempotent"` means an
 * equivalent commit already existed and the state is unchanged; `"rejected"`
 * carries the validation or policy error, also with the state unchanged.
 */
export type CoordinatorUploadCommit =
  | {
      commit: Commit;
      cursor?: Cursor;
      retiredObjects?: readonly RetiredCommittedObject[];
      state: CoordinatorPipelineState;
      status: "committed" | "idempotent";
    }
  | {
      error: OlosError;
      state: CoordinatorPipelineState;
      status: "rejected";
    };

/**
 * Result of `revokeCoordinatorUpload`. `"revoked"` and the idempotent
 * `"already_revoked"` carry the next state with the slot's commits removed;
 * `"rejected"` (unknown slot, slot visible in the live cursor, or an invalid
 * state transition) returns the state unchanged.
 */
export type CoordinatorUploadRevocation =
  | {
      slot: UploadSlot;
      state: CoordinatorPipelineState;
      status: "already_revoked" | "revoked";
    }
  | {
      error: OlosError;
      state: CoordinatorPipelineState;
      status: "rejected";
    };
