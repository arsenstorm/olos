import type { Commit } from "../types/commit";
import type {
  CommittedSegment,
  CommittedWindow,
  TrackWindow,
} from "../types/committed-window";
import type { PartNumber, SequenceNumber } from "../types/ids";
import type { ProfileData } from "../types/profile";
import { assertCommit } from "../validation/commit";
import { assertCommittedWindow } from "../validation/committed-window";
import { createTrackWindow, groupByTrack } from "./committed-window-segments";

export const SEGMENT_COMMIT_PART_ORDER = -1;

/** Input of the {@link CreateCommittedWindowOptions.trackWindowProfile} hook. */
export interface TrackWindowProfileInput {
  /** Visible segments, oldest first. */
  segments: readonly CommittedSegment[];
  trackId: string;
  /** Segments trimmed off the front by `maxSegments`, oldest first. */
  trimmedSegments: readonly CommittedSegment[];
}

/** Options for {@link createCommittedWindow}. */
export interface CreateCommittedWindowOptions {
  /** Segment and part commits; must be non-empty. */
  commits: readonly Commit[];
  epoch: number;
  /** Init commits, at most one per track. Tracks without one are fine. */
  initCommits?: readonly Commit[];
  /** When set, only the newest `maxSegments` segments per track are kept. */
  maxSegments?: number;
  sessionId: string;
  /**
   * Profile hook producing each track window's `profile` from its visible
   * and trimmed segments (for example `createMediaTrackWindowProfile` from
   * olos/media). Core records whatever it returns, unchanged.
   */
  trackWindowProfile?: (
    input: TrackWindowProfileInput
  ) => ProfileData | undefined;
}

/**
 * Aggregate commits into the {@link CommittedWindow} that backs stream
 * rendering. Commits are grouped by track and sequence number; within a
 * segment only the contiguous prefix of parts (starting at part 0) becomes
 * visible. Pure. Throws when `commits` is empty, a commit's `sessionId` or
 * `epoch` does not match, a segment or part position is duplicated, or the
 * commits produce no visible segment.
 */
export function createCommittedWindow(
  options: CreateCommittedWindowOptions
): CommittedWindow {
  const window = tryCreateCommittedWindow(options);
  if (window === undefined) {
    throw new Error("commits must produce at least one segment");
  }
  return window;
}

/**
 * Like {@link createCommittedWindow} but returns undefined when no
 * contiguous prefix of parts has landed yet. Used by the state machine to
 * tolerate out-of-order commits at the same sequence number — the new
 * commit is recorded in state.commits but the cursor doesn't advance until
 * the contiguous prefix is complete.
 */
export function tryCreateCommittedWindow(
  options: CreateCommittedWindowOptions
): CommittedWindow | undefined {
  const initCommits = validateCommits(options.initCommits ?? [], options);
  const mediaCommits = validateCommits(options.commits, options);

  if (mediaCommits.length === 0) {
    throw new Error("commits must be a non-empty array");
  }

  const tracks = createTracks(initCommits, mediaCommits, options);
  const sequenceRange = committedWindowSequenceRange(tracks);
  if (sequenceRange === undefined) {
    return;
  }

  const window: CommittedWindow = {
    epoch: options.epoch,
    firstSequenceNumber: sequenceRange.firstSequenceNumber,
    lastSequenceNumber: sequenceRange.lastSequenceNumber,
    tracks,
  };

  assertCommittedWindow(window);
  return window;
}

// Re-exported from the validation layer, where `assertCursor` also uses it
// to pin `cursor.window.lastPartNumber` to the committed window (§3.8).
// biome-ignore lint/performance/noBarrelFile: single deliberate re-export keeping the state-layer import path stable
export { lastVisiblePartNumber } from "../validation/committed-window";

/**
 * One track's live edge within a committed window: the sequence number of
 * its last visible segment and, when that segment is parts-only, the last
 * visible part number.
 */
export interface TrackWindowBounds {
  /** Absent when the track's last segment is a full segment. */
  lastPartNumber?: PartNumber;
  lastSequenceNumber: SequenceNumber;
}

/**
 * Returns the given track's own live edge within the committed window,
 * or undefined when the track is absent or has no visible segments.
 * Deliberately not compared against the window-global last sequence
 * number — a lagging track's own last segment is its live edge.
 */
export function trackWindowBounds(
  window: CommittedWindow,
  trackId: string
): TrackWindowBounds | undefined {
  const lastSegment = window.tracks[trackId]?.segments.at(-1);

  if (lastSegment === undefined) {
    return;
  }

  const lastPart = lastSegment.parts?.at(-1);

  return {
    lastSequenceNumber: lastSegment.sequenceNumber,
    ...(lastPart === undefined ? {} : { lastPartNumber: lastPart.partNumber }),
  };
}

function validateCommits(
  commits: readonly Commit[],
  options: CreateCommittedWindowOptions
): Commit[] {
  return commits.map((commit) => {
    assertCommit(commit);

    if (commit.sessionId !== options.sessionId) {
      throw new Error("commit.sessionId must match sessionId");
    }

    if (commit.epoch !== options.epoch) {
      throw new Error("commit.epoch must match epoch");
    }

    return commit;
  });
}

function createTracks(
  initCommits: readonly Commit[],
  mediaCommits: readonly Commit[],
  options: CreateCommittedWindowOptions
): Record<string, TrackWindow> {
  const initByTrack = createInitCommitsByTrack(initCommits);
  const commitsByTrack = groupByTrack(mediaCommits);
  const tracks: Record<string, TrackWindow> = {};

  for (const [trackId, commits] of commitsByTrack) {
    const track = createTrackWindow({
      commits,
      init: initByTrack.get(trackId),
      maxSegments: options.maxSegments,
      trackId,
      trackWindowProfile: options.trackWindowProfile,
    });

    // A track whose only commits are out-of-order parts (no contiguous
    // prefix yet) has no visible segments. Omit it from the window — the
    // same shape as a track with no commits at all — so the commit stays
    // recorded without rendering (§5.2, §5.3).
    if (track.segments.length > 0) {
      tracks[trackId] = track;
    }
  }

  return tracks;
}

function committedWindowSequenceRange(
  tracks: Record<string, TrackWindow>
):
  | Pick<CommittedWindow, "firstSequenceNumber" | "lastSequenceNumber">
  | undefined {
  const sequenceNumbers = Object.values(tracks).flatMap((track) =>
    track.segments.map((segment) => segment.sequenceNumber)
  );

  if (sequenceNumbers.length === 0) {
    return;
  }

  return {
    firstSequenceNumber: Math.min(...sequenceNumbers),
    lastSequenceNumber: Math.max(...sequenceNumbers),
  };
}

function createInitCommitsByTrack(
  initCommits: readonly Commit[]
): Map<string, Commit> {
  const initByTrack = new Map<string, Commit>();

  for (const commit of initCommits) {
    if (initByTrack.has(commit.trackId)) {
      throw new Error("initCommits must not contain duplicate track IDs");
    }

    initByTrack.set(commit.trackId, commit);
  }

  return initByTrack;
}
