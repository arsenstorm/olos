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
import { assertPositiveInteger } from "./integers";

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
  const initCommits = validateCommits(options.initCommits, options);
  const mediaCommits = validateCommits(options.commits, options);

  if (initCommits.length === 0) {
    throw new Error("initCommits must be a non-empty array");
  }

  if (mediaCommits.length === 0) {
    throw new Error("commits must be a non-empty array");
  }

  const renditions = createRenditions(initCommits, mediaCommits, options);
  const sequences = Object.values(renditions).flatMap((rendition) =>
    rendition.segments.map((segment) => segment.mediaSequenceNumber)
  );

  if (sequences.length === 0) {
    throw new Error("commits must produce at least one segment");
  }

  const window: CommittedWindow = {
    discontinuitySequence: options.discontinuitySequence ?? 0,
    epoch: options.epoch,
    firstMediaSequenceNumber: Math.min(...sequences),
    lastMediaSequenceNumber: Math.max(...sequences),
    renditions,
  };

  assertCommittedWindow(window);
  return window;
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
  const initByRendition = new Map<string, Commit>();

  for (const commit of initCommits) {
    if (initByRendition.has(commit.renditionId)) {
      throw new Error("initCommits must not contain duplicate rendition IDs");
    }

    initByRendition.set(commit.renditionId, commit);
  }

  const commitsByRendition = groupByRendition(mediaCommits);
  const renditions: Record<string, RenditionWindow> = {};

  for (const [renditionId, commits] of commitsByRendition) {
    const init = initByRendition.get(renditionId);

    if (!init) {
      throw new Error(`missing init commit for rendition: ${renditionId}`);
    }

    renditions[renditionId] = {
      init: committedObject(init),
      renditionId,
      segments: createSegments(commits, options.maxSegments),
    };
  }

  return renditions;
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
  const segmentsBySequence = new Map<number, CommittedSegment>();
  const sortedCommits = [...commits].sort(compareCommitPosition);

  for (const commit of sortedCommits) {
    const segment = segmentForCommit(segmentsBySequence, commit);
    addCommitToSegment(segment, commit);
  }

  const segments = [...segmentsBySequence.values()]
    .map(commitContiguousParts)
    .filter(hasCommittedMedia)
    .sort(
      (left, right) => left.mediaSequenceNumber - right.mediaSequenceNumber
    );

  if (maxSegments !== undefined) {
    assertPositiveInteger(maxSegments, "maxSegments");
    return segments.slice(-maxSegments);
  }

  return segments;
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

  const parts: CommittedPart[] = [];

  for (const part of segment.parts) {
    if (part.partNumber !== parts.length) {
      break;
    }

    parts.push(part);
  }

  return parts.length === 0
    ? { ...segment, parts: undefined }
    : { ...segment, parts };
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

  return (left.partNumber ?? -1) - (right.partNumber ?? -1);
}
