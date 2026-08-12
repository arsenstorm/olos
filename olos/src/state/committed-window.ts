import type { Commit } from "../types/commit";
import type {
  CommittedWindow,
  RenditionWindow,
} from "../types/committed-window";
import type { MediaSequenceNumber, PartNumber } from "../types/ids";
import { assertCommit } from "../validation/commit";
import { assertCommittedWindow } from "../validation/committed-window";
import {
  createRenditionWindow,
  groupByRendition,
} from "./committed-window-segments";

export const SEGMENT_COMMIT_PART_ORDER = -1;

/** Options for {@link createCommittedWindow}. */
export interface CreateCommittedWindowOptions {
  /** Media (segment and part) commits; must be non-empty. */
  commits: readonly Commit[];
  /** Value surfaced as `EXT-X-DISCONTINUITY-SEQUENCE` (default 0). */
  discontinuitySequence?: number;
  epoch: number;
  /** Init-segment commits, one per rendition present in `commits`. */
  initCommits: readonly Commit[];
  /** When set, only the newest `maxSegments` segments per rendition are kept. */
  maxSegments?: number;
  sessionId: string;
}

/**
 * Aggregate commits into the {@link CommittedWindow} that backs playlist
 * generation. Commits are grouped by rendition and media sequence number;
 * within a segment only the contiguous prefix of parts (starting at part
 * 0) becomes visible, and a parts-only segment's duration is the sum of
 * its visible parts. Pure. Throws when either commit list is empty, a
 * commit's `sessionId` or `epoch` does not match, a rendition lacks an
 * init commit, a segment or part position is duplicated, or the commits
 * produce no visible segment.
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
 * tolerate out-of-order commits at the same media-sequence-number — the
 * new commit is recorded in state.commits but the cursor doesn't advance
 * until the contiguous prefix is complete.
 */
export function tryCreateCommittedWindow(
  options: CreateCommittedWindowOptions
): CommittedWindow | undefined {
  const initCommits = validateCommits(options.initCommits, options);
  const mediaCommits = validateCommits(options.commits, options);

  if (initCommits.length === 0) {
    throw new Error("initCommits must be a non-empty array");
  }

  if (mediaCommits.length === 0) {
    throw new Error("commits must be a non-empty array");
  }

  const renditions = createRenditions(initCommits, mediaCommits, options);
  const mediaSequenceRange = committedWindowMediaSequenceRange(renditions);
  if (mediaSequenceRange === undefined) {
    return;
  }

  const window: CommittedWindow = {
    discontinuitySequence: options.discontinuitySequence ?? 0,
    epoch: options.epoch,
    firstMediaSequenceNumber: mediaSequenceRange.firstMediaSequenceNumber,
    lastMediaSequenceNumber: mediaSequenceRange.lastMediaSequenceNumber,
    renditions,
  };

  assertCommittedWindow(window);
  return window;
}

// Re-exported from the validation layer, where `assertCursor` also uses it
// to pin `cursor.window.lastPartNumber` to the committed window (§3.8).
// biome-ignore lint/performance/noBarrelFile: single deliberate re-export keeping the state-layer import path stable
export { lastVisiblePartNumber } from "../validation/committed-window";

/**
 * One rendition's live edge within a committed window: the media sequence
 * number of its last visible segment and, when that segment is parts-only,
 * the last visible part number.
 */
export interface RenditionWindowBounds {
  lastMediaSequenceNumber: MediaSequenceNumber;
  /** Absent when the rendition's last segment is a full segment. */
  lastPartNumber?: PartNumber;
}

/**
 * Returns the given rendition's own live edge within the committed window,
 * or undefined when the rendition is absent or has no visible segments.
 * Deliberately not compared against the window-global last media sequence
 * number — a lagging rendition's own last segment is its live edge.
 */
export function renditionWindowBounds(
  window: CommittedWindow,
  renditionId: string
): RenditionWindowBounds | undefined {
  const lastSegment = window.renditions[renditionId]?.segments.at(-1);

  if (lastSegment === undefined) {
    return;
  }

  const lastPart = lastSegment.parts?.at(-1);

  return {
    lastMediaSequenceNumber: lastSegment.mediaSequenceNumber,
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

function createRenditions(
  initCommits: readonly Commit[],
  mediaCommits: readonly Commit[],
  options: CreateCommittedWindowOptions
): Record<string, RenditionWindow> {
  const initByRendition = createInitCommitsByRendition(initCommits);
  const commitsByRendition = groupByRendition(mediaCommits);
  const renditions: Record<string, RenditionWindow> = {};

  for (const [renditionId, commits] of commitsByRendition) {
    const init = initByRendition.get(renditionId);

    if (!init) {
      throw new Error(`missing init commit for rendition: ${renditionId}`);
    }

    const rendition = createRenditionWindow({
      commits,
      discontinuitySequence: options.discontinuitySequence ?? 0,
      init,
      maxSegments: options.maxSegments,
      renditionId,
    });

    // A rendition whose only media commits are out-of-order parts (no
    // contiguous prefix yet) has no visible segments. Omit it from the
    // window — the same shape as a rendition with no media commits at all
    // — so the commit stays recorded without rendering (§5.2, §5.3).
    if (rendition.segments.length > 0) {
      renditions[renditionId] = rendition;
    }
  }

  return renditions;
}

function committedWindowMediaSequenceRange(
  renditions: Record<string, RenditionWindow>
):
  | Pick<
      CommittedWindow,
      "firstMediaSequenceNumber" | "lastMediaSequenceNumber"
    >
  | undefined {
  const mediaSequenceNumbers = Object.values(renditions).flatMap((rendition) =>
    rendition.segments.map((segment) => segment.mediaSequenceNumber)
  );

  if (mediaSequenceNumbers.length === 0) {
    return;
  }

  return {
    firstMediaSequenceNumber: Math.min(...mediaSequenceNumbers),
    lastMediaSequenceNumber: Math.max(...mediaSequenceNumbers),
  };
}

function createInitCommitsByRendition(
  initCommits: readonly Commit[]
): Map<string, Commit> {
  const initByRendition = new Map<string, Commit>();

  for (const commit of initCommits) {
    if (initByRendition.has(commit.renditionId)) {
      throw new Error("initCommits must not contain duplicate rendition IDs");
    }

    initByRendition.set(commit.renditionId, commit);
  }

  return initByRendition;
}
