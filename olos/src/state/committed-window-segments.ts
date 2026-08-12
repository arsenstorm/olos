import type { Commit } from "../types/commit";
import type {
  CommittedObject,
  CommittedPart,
  CommittedSegment,
  RenditionWindow,
} from "../types/committed-window";
import { assertPositiveInteger } from "../validation/ids";
import { SEGMENT_COMMIT_PART_ORDER } from "./committed-window";
export function createRenditionWindow({
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

export function groupByRendition(
  commits: readonly Commit[]
): Map<string, Commit[]> {
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
  // Lift the commit's program date time onto the segment. The renderer emits
  // EXT-X-PROGRAM-DATE-TIME from the segment, and commits arrive in position
  // order, so the first carrier — part 0 for a parted segment, otherwise the
  // segment commit — anchors the segment's wall-clock start. Without this the
  // wire field and the CommittedSegment field were never connected and the
  // tag could not be emitted at all.
  if (
    commit.programDateTime !== undefined &&
    segment.programDateTime === undefined
  ) {
    segment.programDateTime = commit.programDateTime;
  }

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
