import type { Commit } from "../types/commit";
import type {
  CommittedObject,
  CommittedPart,
  CommittedSegment,
  TrackWindow,
} from "../types/committed-window";
import { assertPositiveInteger } from "../validation/ids";
import {
  type CreateCommittedWindowOptions,
  SEGMENT_COMMIT_PART_ORDER,
} from "./committed-window";

export function createTrackWindow({
  commits,
  init,
  maxSegments,
  trackId,
  trackWindowProfile,
}: {
  commits: readonly Commit[];
  init?: Commit;
  maxSegments?: number;
  trackId: string;
  trackWindowProfile?: CreateCommittedWindowOptions["trackWindowProfile"];
}): TrackWindow {
  const segments = finalizeCommittedSegments(createSegmentsBySequence(commits));
  const visibleSegments = limitCommittedSegments(segments, maxSegments);
  const trimmedSegments = segments.slice(
    0,
    segments.length - visibleSegments.length
  );
  const profile = trackWindowProfile?.({
    segments: visibleSegments,
    trackId,
    trimmedSegments,
  });

  return {
    ...(init === undefined ? {} : { init: committedObject(init) }),
    ...(profile === undefined ? {} : { profile }),
    segments: visibleSegments,
    trackId,
  };
}

export function groupByTrack(
  commits: readonly Commit[]
): Map<string, Commit[]> {
  const groups = new Map<string, Commit[]>();

  for (const commit of commits) {
    const group = groups.get(commit.trackId);

    if (group) {
      group.push(commit);
    } else {
      groups.set(commit.trackId, [commit]);
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
    .filter(hasCommittedObjects)
    .sort((left, right) => left.sequenceNumber - right.sequenceNumber);
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

  return { ...segment, parts };
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

function hasCommittedObjects(segment: CommittedSegment): boolean {
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
  const existing = segmentsBySequence.get(commit.sequenceNumber);

  if (existing) {
    return existing;
  }

  const segment: CommittedSegment = { sequenceNumber: commit.sequenceNumber };

  segmentsBySequence.set(commit.sequenceNumber, segment);
  return segment;
}

function committedObject(commit: Commit): CommittedObject {
  return {
    commitId: commit.commitId,
    deliveryUrl: commit.deliveryUrl,
    ...(commit.etag === undefined ? {} : { etag: commit.etag }),
    objectKey: commit.objectKey,
    ...(commit.profile === undefined ? {} : { profile: commit.profile }),
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
    partNumber: commit.partNumber,
  };
}

function compareCommitPosition(left: Commit, right: Commit): number {
  if (left.sequenceNumber !== right.sequenceNumber) {
    return left.sequenceNumber - right.sequenceNumber;
  }

  return (
    (left.partNumber ?? SEGMENT_COMMIT_PART_ORDER) -
    (right.partNumber ?? SEGMENT_COMMIT_PART_ORDER)
  );
}
