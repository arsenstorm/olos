import type { Commit } from "../types/commit";
import type {
  CommittedObject,
  CommittedPart,
  CommittedSegment,
  CommittedWindow,
  RenditionWindow,
} from "../types/committed-window";
import type { MediaSequenceNumber, PartNumber } from "../types/ids";
import { assertCommit } from "../validation/commit";
import { assertCommittedWindow } from "../validation/committed-window";
import { assertPositiveInteger } from "../validation/ids";

const SEGMENT_COMMIT_PART_ORDER = -1;

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

    renditions[renditionId] = createRenditionWindow({
      commits,
      discontinuitySequence: options.discontinuitySequence ?? 0,
      init,
      maxSegments: options.maxSegments,
      renditionId,
    });
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

function createRenditionWindow({
  commits,
  discontinuitySequence,
  init,
  maxSegments,
  renditionId,
}: {
  commits: readonly Commit[];
  discontinuitySequence: number;
  init: Commit;
  maxSegments?: number;
  renditionId: string;
}): RenditionWindow {
  const segments = finalizeCommittedSegments(createSegmentsBySequence(commits));
  const visibleSegments = limitCommittedSegments(segments, maxSegments);
  // Trimmed leading segments take their discontinuity markers with them;
  // count them into this rendition's discontinuity sequence (RFC 8216
  // §6.2.2). The field stays absent while it matches the window-global
  // value so unchanged windows keep their serialized shape.
  const trimmedCount = segments.length - visibleSegments.length;
  const renditionDiscontinuitySequence =
    discontinuitySequence +
    segments
      .slice(0, trimmedCount)
      .filter((segment) => segment.discontinuityBefore === true).length;

  return {
    ...(renditionDiscontinuitySequence === discontinuitySequence
      ? {}
      : { discontinuitySequence: renditionDiscontinuitySequence }),
    init: committedObject(init),
    renditionId,
    segments: visibleSegments,
  };
}

function groupByRendition(commits: readonly Commit[]): Map<string, Commit[]> {
  const groups = new Map<string, Commit[]>();

  for (const commit of commits) {
    const group = groups.get(commit.renditionId);

    if (group) {
      group.push(commit);
    } else {
      groups.set(commit.renditionId, [commit]);
    }
  }

  return groups;
}

function createSegmentsBySequence(
  commits: readonly Commit[]
): Map<number, CommittedSegment> {
  const segmentsBySequence = new Map<number, CommittedSegment>();
  const sortedCommits = [...commits].sort(compareCommitPosition);

  for (const commit of sortedCommits) {
    const segment = segmentForCommit(segmentsBySequence, commit);
    addCommitToSegment(segment, commit);
  }

  return segmentsBySequence;
}

function finalizeCommittedSegments(
  segmentsBySequence: Map<number, CommittedSegment>
): CommittedSegment[] {
  return [...segmentsBySequence.values()]
    .map(commitContiguousParts)
    .filter(hasCommittedMedia)
    .sort(
      (left, right) => left.mediaSequenceNumber - right.mediaSequenceNumber
    );
}

function limitCommittedSegments(
  segments: readonly CommittedSegment[],
  maxSegments: number | undefined
): CommittedSegment[] {
  if (maxSegments !== undefined) {
    assertPositiveInteger(maxSegments, "maxSegments");
    return segments.slice(-maxSegments);
  }

  return [...segments];
}

function addCommitToSegment(segment: CommittedSegment, commit: Commit): void {
  if (commit.partNumber === undefined) {
    if (segment.segment !== undefined) {
      throw new Error("commits must not contain duplicate segment positions");
    }

    segment.segment = committedObject(commit);
    return;
  }

  const parts = segment.parts ?? [];
  parts.push(committedPart(commit));
  segment.parts = parts;
}

function commitContiguousParts(segment: CommittedSegment): CommittedSegment {
  if (segment.parts === undefined) {
    return segment;
  }

  assertUniqueParts(segment.parts);

  const parts = contiguousPartsPrefix(segment.parts);

  if (parts.length === 0) {
    return { ...segment, parts: undefined };
  }

  if (segment.segment !== undefined) {
    return { ...segment, parts };
  }

  // A parts-only segment's duration was seeded from whichever commit sorted
  // first (usually part 0), undercounting the in-progress segment. Report
  // the sum of the visible contiguous parts instead; full-segment commits
  // keep their authoritative duration above.
  return { ...segment, duration: totalPartsDuration(parts), parts };
}

function totalPartsDuration(parts: readonly CommittedPart[]): number {
  return parts.reduce((total, part) => total + part.duration, 0);
}

function contiguousPartsPrefix(
  parts: readonly CommittedPart[]
): CommittedPart[] {
  const contiguousParts: CommittedPart[] = [];

  for (const part of parts) {
    if (part.partNumber !== contiguousParts.length) {
      break;
    }

    contiguousParts.push(part);
  }

  return contiguousParts;
}

function hasCommittedMedia(segment: CommittedSegment): boolean {
  return segment.segment !== undefined || segment.parts !== undefined;
}

function assertUniqueParts(parts: readonly CommittedPart[]): void {
  const seen = new Set<number>();

  for (const part of parts) {
    if (seen.has(part.partNumber)) {
      throw new Error("commits must not contain duplicate part positions");
    }

    seen.add(part.partNumber);
  }
}

function segmentForCommit(
  segmentsBySequence: Map<number, CommittedSegment>,
  commit: Commit
): CommittedSegment {
  const existing = segmentsBySequence.get(commit.mediaSequenceNumber);

  if (existing) {
    return existing;
  }

  const segment: CommittedSegment = {
    duration: commit.duration,
    mediaSequenceNumber: commit.mediaSequenceNumber,
  };

  segmentsBySequence.set(commit.mediaSequenceNumber, segment);
  return segment;
}

function committedObject(commit: Commit): CommittedObject {
  return {
    commitId: commit.commitId,
    deliveryUrl: commit.deliveryUrl,
    duration: commit.duration,
    ...(commit.etag === undefined ? {} : { etag: commit.etag }),
    objectKey: commit.objectKey,
    slotId: commit.slotId,
  };
}

function committedPart(commit: Commit): CommittedPart {
  if (commit.partNumber === undefined) {
    throw new Error("commit.partNumber must be defined for parts");
  }

  return {
    ...committedObject(commit),
    ...(commit.byterange === undefined ? {} : { byterange: commit.byterange }),
    duration: commit.duration,
    ...(commit.independent === undefined
      ? {}
      : { independent: commit.independent }),
    partNumber: commit.partNumber,
    ...(commit.programDateTime === undefined
      ? {}
      : { programDateTime: commit.programDateTime }),
  };
}

function compareCommitPosition(left: Commit, right: Commit): number {
  if (left.mediaSequenceNumber !== right.mediaSequenceNumber) {
    return left.mediaSequenceNumber - right.mediaSequenceNumber;
  }

  return (
    (left.partNumber ?? SEGMENT_COMMIT_PART_ORDER) -
    (right.partNumber ?? SEGMENT_COMMIT_PART_ORDER)
  );
}
