import { commitS3RuntimeUpload, issueS3RuntimeUploadGrant } from "olos/s3";
import type { Byterange, Pathway, Session } from "olos/types";

const TENANT_ID = "tenant_streamer";
const PUBLISHER_INSTANCE_ID = "streamer_obs";
const PROVIDER_ID = "example_primary";
// Slot expiry must be >= the Worker's upload-grant TTL (5s). 10s is a
// comfortable margin so the slot doesn't lapse before ffmpeg finishes
// writing the segment and we PUT it.
const GRANT_EXPIRY_SECONDS = 10;

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

export interface OlosClient {
  createSession(options: CreateSessionOptions): Promise<void>;
  endSession(): Promise<void>;
  publishInit(options: PublishInitOptions): Promise<void>;
  publishPart(options: PublishPartOptions): Promise<void>;
  publishSegment(options: PublishSegmentOptions): Promise<void>;
}

interface PublishSpec {
  byterange?: Byterange;
  bytes: Uint8Array;
  commitId: string;
  deliveryUrl: string;
  duration: number;
  independent: boolean;
  kind: ObjectKind;
  mediaSequenceNumber: number;
  objectKey: string;
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
      const objectKey = `live/${options.sessionId}/${options.renditionId}/init.mp4`;
      return publish(options, ingestFetch, {
        bytes,
        commitId: `${options.sessionId}_commit_init`,
        deliveryUrl: `${options.mediaOrigin}/media/${objectKey}`,
        duration,
        independent: false,
        kind: "init",
        mediaSequenceNumber,
        objectKey,
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
      const objectKey = `live/${options.sessionId}/${options.renditionId}/${mediaSequenceNumber}-part-${partNumber}.m4s`;
      return publish(options, ingestFetch, {
        byterange,
        bytes,
        commitId: `${options.sessionId}_commit_${mediaSequenceNumber}_part_${partNumber}`,
        deliveryUrl: `${options.mediaOrigin}/media/${objectKey}`,
        duration,
        independent,
        kind: "part",
        mediaSequenceNumber,
        objectKey,
        partNumber,
        slotId: `${options.sessionId}_slot_${mediaSequenceNumber}_part_${partNumber}`,
      });
    },
    publishSegment({ bytes, duration, mediaSequenceNumber }) {
      const objectKey = `live/${options.sessionId}/${options.renditionId}/${mediaSequenceNumber}.m4s`;
      return publish(options, ingestFetch, {
        bytes,
        commitId: `${options.sessionId}_commit_${mediaSequenceNumber}`,
        deliveryUrl: `${options.mediaOrigin}/media/${objectKey}`,
        duration,
        independent: true,
        kind: "segment",
        mediaSequenceNumber,
        objectKey,
        slotId: `${options.sessionId}_slot_${mediaSequenceNumber}`,
      });
    },
    endSession() {
      return endSession(options, ingestHeaders);
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
    tenantId: TENANT_ID,
  };

  const pathways: Pathway[] = [
    {
      baseUrl: options.mediaOrigin,
      pathwayId: "primary",
      priority: 0,
      providerId: PROVIDER_ID,
      state: "active",
    },
  ];

  const response = await fetch(`${options.baseUrl}/sessions`, {
    body: JSON.stringify({ pathways, session }),
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
  const expiresAt = new Date(
    Date.now() + GRANT_EXPIRY_SECONDS * 1000
  ).toISOString();

  const granted = await issueS3RuntimeUploadGrant({
    baseUrl: options.baseUrl,
    fetch: ingestFetch,
    payload: {
      ...(spec.byterange === undefined ? {} : { byterange: spec.byterange }),
      contentType: "video/mp4",
      deliveryUrl: spec.deliveryUrl,
      duration: spec.duration,
      expiresAt,
      kind: spec.kind,
      maxBytes: spec.bytes.length,
      mediaSequenceNumber: spec.mediaSequenceNumber,
      objectKey: spec.objectKey,
      ...(spec.partNumber === undefined ? {} : { partNumber: spec.partNumber }),
      publicationMode: "direct-public",
      publisherInstanceId: PUBLISHER_INSTANCE_ID,
      renditionId: options.renditionId,
      slotId: spec.slotId,
    },
    sessionId: options.sessionId,
  });

  const upload = await fetch(granted.grant.url, {
    body: spec.bytes,
    headers: granted.grant.requiredHeaders ?? {},
    method: "PUT",
  });

  if (!upload.ok) {
    throw new Error(
      `PUT ${spec.objectKey} ${upload.status}: ${await upload.text()}`
    );
  }

  await commitS3RuntimeUpload({
    baseUrl: options.baseUrl,
    fetch: ingestFetch,
    payload: {
      commitId: spec.commitId,
      committedAt: new Date().toISOString(),
      independent: spec.independent,
      objectKey: spec.objectKey,
      slotId: spec.slotId,
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
