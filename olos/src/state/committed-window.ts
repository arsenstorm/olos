import type { Commit } from "../types/commit";
import type {
  CommittedObject,
  CommittedPart,
  CommittedSegment,
  CommittedWindow,
  RenditionWindow,
} from "../types/committed-window";
import { assertCommit } from "../validation/commit";
import { assertCommittedWindow } from "../validation/committed-window";
import { assertPositiveInteger } from "../validation/ids";

const SEGMENT_COMMIT_PART_ORDER = -1;

export interface CreateCommittedWindowOptions {
  commits: readonly Commit[];
  discontinuitySequence?: number;
  epoch: number;
  initCommits: readonly Commit[];
  maxSegments?: number;
  sessionId: string;
}

export function createCommittedWindow(
  options: CreateCommittedWindowOptions
): CommittedWindow {
  const window = tryCreateCommittedWindow(options);
  if (window === undefined) {
    throw new Error("commits must produce at least one segment");
  }
  return window;
}

// Like createCommittedWindow but returns undefined when no contiguous prefix
// of parts has landed yet. Used by the state machine to tolerate out-of-order
// commits at the same media-sequence-number — the new commit is recorded in
// state.commits but the cursor doesn't advance until the contiguous prefix
// is complete.
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

// Returns the highest part number on the visible window's last segment
// across all renditions, or undefined when the last segment is a full
// segment (no parts) or no segments exist.
export function lastVisiblePartNumber(
  window: CommittedWindow
): number | undefined {
  let max: number | undefined;

  for (const rendition of Object.values(window.renditions)) {
    const lastSegment = rendition.segments.at(-1);

    if (lastSegment?.mediaSequenceNumber !== window.lastMediaSequenceNumber) {
      continue;
    }

    const lastPart = lastSegment.parts?.at(-1);

    if (lastPart === undefined) {
      continue;
    }

    if (max === undefined || lastPart.partNumber > max) {
      max = lastPart.partNumber;
    }
  }

  return max;
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
  init,
  maxSegments,
  renditionId,
}: {
  commits: readonly Commit[];
  init: Commit;
  maxSegments?: number;
  renditionId: string;
}): RenditionWindow {
  return {
    init: committedObject(init),
    renditionId,
    segments: createSegments(commits, maxSegments),
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

function createSegments(
  commits: readonly Commit[],
  maxSegments: number | undefined
): CommittedSegment[] {
  const segments = finalizeCommittedSegments(createSegmentsBySequence(commits));

  return limitCommittedSegments(segments, maxSegments);
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

  return parts.length === 0
    ? { ...segment, parts: undefined }
    : { ...segment, parts };
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
