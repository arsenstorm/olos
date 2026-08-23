import type { MediaObjectProfile } from "@arsenstorm/olos/media";
import {
  commitS3RuntimeUpload,
  issueS3RuntimeUploadGrant,
} from "@arsenstorm/olos/s3";
import type { Byterange } from "@arsenstorm/olos/types";
import {
  type CreateSessionOptions,
  createSession,
  endSession,
} from "./olos-session";

export type { CreateSessionOptions } from "./olos-session";

// Slot expiry must be >= the Worker's upload-grant TTL (5s). 10s is a
// comfortable margin so the slot doesn't lapse before ffmpeg finishes
// writing the segment and we PUT it.
const GRANT_EXPIRY_SECONDS = 10;

// Sliding live window. Bounds the coordinator's persisted commit history so
// manifest rendering stays O(window) instead of O(session-age). 6 segments
// × 2 s = 12 s of DVR, comfortably above LL-HLS minimums.
const LIVE_WINDOW_SEGMENTS = 6;

type IngestFetch = (
  input: Request | URL | string,
  init?: RequestInit
) => Promise<Response>;

type ObjectKind = "init" | "part" | "segment";

// Object keys carry the conventional CMAF extensions so the media proxy and
// players can tell init segments (`.mp4`) from media (`.m4s`) by name.
const OBJECT_EXTENSIONS: Record<ObjectKind, string> = {
  init: "mp4",
  part: "m4s",
  segment: "m4s",
};

export interface OlosClientOptions {
  baseUrl: string;
  ingestKey: string;
  mediaOrigin: string;
  sessionId: string;
  trackId: string;
}

export interface PublishInitOptions {
  bytes: Uint8Array;
  duration: number;
  sequenceNumber: number;
}

export type PublishSegmentOptions = PublishInitOptions;

export interface PublishPartOptions {
  byterange?: Byterange;
  bytes: Uint8Array;
  duration: number;
  independent: boolean;
  partNumber: number;
  sequenceNumber: number;
}

export interface PendingPublication {
  commitId: string;
  objectKey: string;
  // Commit-time profile facts; merged over the slot's profile (which
  // already carries `duration`) by the coordinator.
  profile: MediaObjectProfile;
  slotId: string;
}

export interface IssuedGrant extends PendingPublication {
  bytes: Uint8Array;
  requiredHeaders: Record<string, string>;
  uploadUrl: string;
}

export interface OlosClient {
  commitPublication(pending: PendingPublication): Promise<void>;
  createSession(options: CreateSessionOptions): Promise<void>;
  endSession(): Promise<void>;
  // Three-phase publish for the part hot path.
  //   issueGrant runs the slot grant (a coordinator state mutation —
  //     callers must serialize across concurrent parts to avoid
  //     etag-conflict retry storms on Workers Free's ~10 ms CPU cap).
  //   uploadGranted runs the R2 PUT (no state contention — parallel-safe).
  //   commitPublication finalises the commit (same serialization constraint
  //     as issueGrant).
  issueGrant(options: PublishPartOptions): Promise<IssuedGrant>;
  publishInit(options: PublishInitOptions): Promise<void>;
  publishPart(options: PublishPartOptions): Promise<void>;
  publishSegment(options: PublishSegmentOptions): Promise<void>;
  uploadGranted(grant: IssuedGrant): Promise<PendingPublication>;
}

interface PublishSpec {
  byterange?: Byterange;
  bytes: Uint8Array;
  commitId: string;
  duration: number;
  independent: boolean;
  kind: ObjectKind;
  partNumber?: number;
  programDateTime?: string;
  sequenceNumber: number;
  slotId: string;
}

function commitProfile(spec: PublishSpec): MediaObjectProfile {
  return {
    independent: spec.independent,
    ...(spec.programDateTime === undefined
      ? {}
      : { programDateTime: spec.programDateTime }),
  };
}

interface SegmentStartAnchor {
  anchor(sequenceNumber: number): string;
  release(sequenceNumber: number): string;
}

export function createOlosClient(options: OlosClientOptions): OlosClient {
  const ingestFetch = createIngestFetch(options.ingestKey);
  const segmentStart = createSegmentStartAnchor();
  const publishSpec = (spec: PublishSpec) =>
    publish(options, ingestFetch, spec);

  return {
    commitPublication: (pending) =>
      commitPublication(options, ingestFetch, pending),
    createSession: (input) => createSession(options, ingestFetch, input),
    endSession: () => endSession(options, ingestFetch),
    issueGrant: (input) =>
      issueGrant(options, ingestFetch, partSpec(options, segmentStart, input)),
    publishInit: (input) => publishSpec(initSpec(options, input)),
    publishPart: (input) => publishSpec(partSpec(options, segmentStart, input)),
    publishSegment: (input) =>
      publishSpec(segmentSpec(options, segmentStart, input)),
    uploadGranted,
  };
}

function createIngestFetch(ingestKey: string): IngestFetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${ingestKey}`);
    return fetch(input, { ...init, headers });
  };
}

// Apple's low-latency profile requires EXT-X-PROGRAM-DATE-TIME; without it
// the player reports "Low Latency: Playlist does not have
// EXT-X-PROGRAM-DATE-TIME tag" (CoreMedia -15412) and drops out of
// low-latency mode. The tag must come from whichever commit first creates
// the segment entry — that is part 0, not the later full-segment commit —
// so the segment's start time is anchored once and reused.
function createSegmentStartAnchor(): SegmentStartAnchor {
  const segmentStartTimes = new Map<number, string>();

  const anchor = (sequenceNumber: number): string => {
    const existing = segmentStartTimes.get(sequenceNumber);
    if (existing !== undefined) {
      return existing;
    }
    const startedAt = new Date().toISOString();
    segmentStartTimes.set(sequenceNumber, startedAt);
    return startedAt;
  };

  return {
    anchor,
    release(sequenceNumber) {
      const startedAt = anchor(sequenceNumber);
      segmentStartTimes.delete(sequenceNumber);
      return startedAt;
    },
  };
}

function initSpec(
  options: OlosClientOptions,
  { bytes, duration, sequenceNumber }: PublishInitOptions
): PublishSpec {
  return {
    bytes,
    commitId: `${options.sessionId}_commit_init`,
    duration,
    independent: false,
    kind: "init",
    sequenceNumber,
    slotId: `${options.sessionId}_slot_init`,
  };
}

function partSpec(
  options: OlosClientOptions,
  segmentStart: SegmentStartAnchor,
  input: PublishPartOptions
): PublishSpec {
  const { sequenceNumber, partNumber } = input;
  const id = `${sequenceNumber}_part_${partNumber}`;

  return {
    byterange: input.byterange,
    bytes: input.bytes,
    commitId: `${options.sessionId}_commit_${id}`,
    duration: input.duration,
    independent: input.independent,
    kind: "part",
    partNumber,
    sequenceNumber,
    ...(partNumber === 0
      ? { programDateTime: segmentStart.anchor(sequenceNumber) }
      : {}),
    slotId: `${options.sessionId}_slot_${id}`,
  };
}

function segmentSpec(
  options: OlosClientOptions,
  segmentStart: SegmentStartAnchor,
  { bytes, duration, sequenceNumber }: PublishSegmentOptions
): PublishSpec {
  return {
    bytes,
    commitId: `${options.sessionId}_commit_${sequenceNumber}`,
    duration,
    independent: true,
    kind: "segment",
    programDateTime: segmentStart.release(sequenceNumber),
    sequenceNumber,
    slotId: `${options.sessionId}_slot_${sequenceNumber}`,
  };
}

async function publish(
  options: OlosClientOptions,
  ingestFetch: IngestFetch,
  spec: PublishSpec
): Promise<void> {
  const grant = await issueGrant(options, ingestFetch, spec);
  const pending = await uploadGranted(grant);
  await commitPublication(options, ingestFetch, pending);
}

async function issueGrant(
  options: OlosClientOptions,
  ingestFetch: IngestFetch,
  spec: PublishSpec
): Promise<IssuedGrant> {
  const expiresAt = new Date(
    Date.now() + GRANT_EXPIRY_SECONDS * 1000
  ).toISOString();

  const granted = await issueS3RuntimeUploadGrant({
    baseUrl: options.baseUrl,
    fetch: ingestFetch,
    payload: {
      ...(spec.byterange === undefined ? {} : { byterange: spec.byterange }),
      contentType: "video/mp4",
      expiresAt,
      extension: OBJECT_EXTENSIONS[spec.kind],
      kind: spec.kind,
      maxBytes: spec.bytes.length,
      sequenceNumber: spec.sequenceNumber,
      ...(spec.partNumber === undefined ? {} : { partNumber: spec.partNumber }),
      profile: { duration: spec.duration },
      slotId: spec.slotId,
      trackId: options.trackId,
    },
    sessionId: options.sessionId,
  });

  return {
    bytes: spec.bytes,
    commitId: spec.commitId,
    objectKey: granted.slot.objectKey,
    profile: commitProfile(spec),
    requiredHeaders: granted.grant.requiredHeaders ?? {},
    slotId: spec.slotId,
    uploadUrl: granted.grant.url,
  };
}

async function uploadGranted(grant: IssuedGrant): Promise<PendingPublication> {
  const upload = await fetch(grant.uploadUrl, {
    body: grant.bytes,
    headers: grant.requiredHeaders,
    method: "PUT",
  });

  if (!upload.ok) {
    throw new Error(
      `PUT ${grant.objectKey} ${upload.status}: ${await upload.text()}`
    );
  }

  return {
    commitId: grant.commitId,
    objectKey: grant.objectKey,
    profile: grant.profile,
    slotId: grant.slotId,
  };
}

async function commitPublication(
  options: OlosClientOptions,
  ingestFetch: IngestFetch,
  pending: PendingPublication
): Promise<void> {
  await commitS3RuntimeUpload({
    baseUrl: options.baseUrl,
    fetch: ingestFetch,
    payload: {
      commitId: pending.commitId,
      committedAt: new Date().toISOString(),
      maxSegments: LIVE_WINDOW_SEGMENTS,
      objectKey: pending.objectKey,
      profile: pending.profile,
      slotId: pending.slotId,
    },
    sessionId: options.sessionId,
  });
}
