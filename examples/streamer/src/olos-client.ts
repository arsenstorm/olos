import {
  commitS3RuntimeUpload,
  issueS3RuntimeUploadGrant,
} from "@arsenstorm/olos/s3";
import type { Byterange, Session } from "@arsenstorm/olos/types";

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

export interface OlosClientOptions {
  baseUrl: string;
  ingestKey: string;
  mediaOrigin: string;
  renditionId: string;
  sessionId: string;
}

export interface CreateSessionOptions {
  partTarget: number;
  segmentTarget: number;
}

export interface PublishInitOptions {
  bytes: Uint8Array;
  duration: number;
  mediaSequenceNumber: number;
}

export interface PublishSegmentOptions {
  bytes: Uint8Array;
  duration: number;
  mediaSequenceNumber: number;
}

export interface PublishPartOptions {
  byterange?: Byterange;
  bytes: Uint8Array;
  duration: number;
  independent: boolean;
  mediaSequenceNumber: number;
  partNumber: number;
}

export interface IssuedGrant {
  bytes: Uint8Array;
  commitId: string;
  independent: boolean;
  objectKey: string;
  requiredHeaders: Record<string, string>;
  slotId: string;
  uploadUrl: string;
}

export interface PendingPublication {
  commitId: string;
  independent: boolean;
  objectKey: string;
  slotId: string;
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
  mediaSequenceNumber: number;
  partNumber?: number;
  slotId: string;
}

export function createOlosClient(options: OlosClientOptions): OlosClient {
  const ingestHeaders = {
    authorization: `Bearer ${options.ingestKey}`,
    "content-type": "application/json",
  };

  const ingestFetch: IngestFetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${options.ingestKey}`);
    return fetch(input, { ...init, headers });
  };

  return {
    createSession({ partTarget, segmentTarget }) {
      return createSession(options, ingestHeaders, partTarget, segmentTarget);
    },
    publishInit({ bytes, duration, mediaSequenceNumber }) {
      return publish(options, ingestFetch, {
        bytes,
        commitId: `${options.sessionId}_commit_init`,
        duration,
        independent: false,
        kind: "init",
        mediaSequenceNumber,
        slotId: `${options.sessionId}_slot_init`,
      });
    },
    publishPart({
      byterange,
      bytes,
      duration,
      independent,
      mediaSequenceNumber,
      partNumber,
    }) {
      return publish(options, ingestFetch, {
        byterange,
        bytes,
        commitId: `${options.sessionId}_commit_${mediaSequenceNumber}_part_${partNumber}`,
        duration,
        independent,
        kind: "part",
        mediaSequenceNumber,
        partNumber,
        slotId: `${options.sessionId}_slot_${mediaSequenceNumber}_part_${partNumber}`,
      });
    },
    publishSegment({ bytes, duration, mediaSequenceNumber }) {
      return publish(options, ingestFetch, {
        bytes,
        commitId: `${options.sessionId}_commit_${mediaSequenceNumber}`,
        duration,
        independent: true,
        kind: "segment",
        mediaSequenceNumber,
        slotId: `${options.sessionId}_slot_${mediaSequenceNumber}`,
      });
    },
    endSession() {
      return endSession(options, ingestHeaders);
    },
    issueGrant({
      byterange,
      bytes,
      duration,
      independent,
      mediaSequenceNumber,
      partNumber,
    }) {
      return issueGrant(options, ingestFetch, {
        byterange,
        bytes,
        commitId: `${options.sessionId}_commit_${mediaSequenceNumber}_part_${partNumber}`,
        duration,
        independent,
        kind: "part",
        mediaSequenceNumber,
        partNumber,
        slotId: `${options.sessionId}_slot_${mediaSequenceNumber}_part_${partNumber}`,
      });
    },
    uploadGranted(grant) {
      return uploadGranted(grant);
    },
    commitPublication(pending) {
      return commitPublication(options, ingestFetch, pending);
    },
  };
}

async function createSession(
  options: OlosClientOptions,
  ingestHeaders: Record<string, string>,
  partTarget: number,
  segmentTarget: number
): Promise<void> {
  const session: Session = {
    createdAt: new Date().toISOString(),
    epoch: 1,
    latencyProfile: "object-ll",
    olos: "1.0",
    partTarget,
    renditions: [
      {
        bitrate: 5_000_000,
        codec: "avc1.640028",
        frameRate: 30,
        height: 1080,
        kind: "video",
        renditionId: options.renditionId,
        width: 1920,
      },
    ],
    segmentTarget,
    sessionId: options.sessionId,
    state: "live",
  };

  const response = await fetch(`${options.baseUrl}/sessions`, {
    body: JSON.stringify({ mediaBaseUrl: options.mediaOrigin, session }),
    headers: ingestHeaders,
    method: "POST",
  });

  if (response.status !== 201) {
    throw new Error(
      `session create ${response.status}: ${await response.text()}`
    );
  }
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
      duration: spec.duration,
      expiresAt,
      kind: spec.kind,
      maxBytes: spec.bytes.length,
      mediaSequenceNumber: spec.mediaSequenceNumber,
      ...(spec.partNumber === undefined ? {} : { partNumber: spec.partNumber }),
      renditionId: options.renditionId,
      slotId: spec.slotId,
    },
    sessionId: options.sessionId,
  });

  return {
    bytes: spec.bytes,
    commitId: spec.commitId,
    independent: spec.independent,
    objectKey: granted.slot.objectKey,
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
    independent: grant.independent,
    objectKey: grant.objectKey,
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
      independent: pending.independent,
      maxSegments: LIVE_WINDOW_SEGMENTS,
      objectKey: pending.objectKey,
      slotId: pending.slotId,
    },
    sessionId: options.sessionId,
  });
}

async function endSession(
  options: OlosClientOptions,
  ingestHeaders: Record<string, string>
): Promise<void> {
  const response = await fetch(
    `${options.baseUrl}/sessions/${options.sessionId}/transition`,
    {
      body: JSON.stringify({ state: "ending" }),
      headers: ingestHeaders,
      method: "POST",
    }
  );

  if (!response.ok) {
    throw new Error(`session end ${response.status}: ${await response.text()}`);
  }
}
