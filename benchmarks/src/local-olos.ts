// The benchmark rig: real ffmpeg encode/decode + a local, zero-cost OLOS.
//
// LOCAL ONLY. No R2/S3/AWS, no credentials, no egress. The S3 "client" only
// presigns URLs locally and is never sent to; uploaded bytes live in an
// in-memory Map and are served from a loopback TLS origin on 127.0.0.1.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryCoordinatorStore } from "@arsenstorm/olos/protocol";
import {
  createMemoryRuntimeCursorNotifier,
  createRuntimeObjectLowLatencyManifestOptions,
  createRuntimeObjectLowLatencyProfile,
} from "@arsenstorm/olos/runtime";
import {
  createStoredS3CoordinatorRuntimeHandler,
  type S3HeadObjectClient,
} from "@arsenstorm/olos/s3";
import type { Session } from "@arsenstorm/olos/types";
import {
  type HeadObjectCommand,
  type HeadObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import { file, serve } from "bun";
import { assertLoopback, generateSelfSignedCert } from "./cert";
import {
  callHandlerExpectOk,
  createSessionRequest,
  type PublishTimestamps,
  publishObject,
  RENDITION_ID,
  SESSION_ID,
} from "./publish";

export type { PublishTimestamps } from "./publish";

const GRANT_TTL_SECONDS = 5;
const BLOCKING_TIMEOUT_MS = 5000;
const LEADING_SLASHES = /^\/+/;
const INIT_DURATION_SECONDS = 1;

export interface LocalOlosOptions {
  fps: number;
  port: number;
}

export interface PublishPartOptions {
  bytes: Uint8Array;
  mediaSequenceNumber: number;
  partNumber: number;
  partSeconds: number;
}

export interface PublishSegmentOptions {
  bytes: Uint8Array;
  mediaSequenceNumber: number;
  segmentSeconds: number;
}

export interface LocalOlos {
  createSession(): Promise<void>;
  handle(request: Request): Promise<Response>;
  mediaBaseUrl: string;
  publishInit(bytes: Uint8Array): Promise<PublishTimestamps>;
  publishPart(options: PublishPartOptions): Promise<PublishTimestamps>;
  publishSegment(options: PublishSegmentOptions): Promise<PublishTimestamps>;
  renditionId: string;
  sessionId: string;
  stop(): Promise<void>;
}

// Presign-only S3 client: the handler signs URLs against this endpoint but the
// bench never sends to it — uploaded bytes live in `byteStore` and are served
// from the loopback origin. Credentials/endpoint are placeholders.
function createPresignOnlyS3Client(): S3Client {
  return new S3Client({
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    endpoint: "https://s3.example.com",
    forcePathStyle: true,
    region: "us-east-1",
  });
}

// HEAD client backed by the in-memory byte store: resolves ContentLength for
// keys we've published, rejects anything else (mirrors a missing S3 object).
function createByteStoreHeadClient(
  byteStore: Map<string, Uint8Array>
): S3HeadObjectClient {
  return {
    send(command: HeadObjectCommand): Promise<HeadObjectCommandOutput> {
      const objectKey = String(command.input.Key);
      const size = byteStore.get(objectKey)?.length;
      if (size === undefined) {
        return Promise.reject(new Error(`unexpected object key: ${objectKey}`));
      }
      return Promise.resolve({
        $metadata: {},
        ContentLength: size,
        ContentType: "video/mp4",
        ETag: `"${objectKey}"`,
        LastModified: new Date("2026-01-01T00:00:01.000Z"),
      });
    },
  };
}

export async function createLocalOlos(
  options: LocalOlosOptions
): Promise<LocalOlos> {
  const mediaBaseUrl = `https://127.0.0.1:${options.port}`;
  assertLoopback(mediaBaseUrl);

  const byteStore = new Map<string, Uint8Array>();
  const profile = createRuntimeObjectLowLatencyProfile();
  const manifestOptions = createRuntimeObjectLowLatencyManifestOptions(profile);
  const notifier = createMemoryRuntimeCursorNotifier();

  const handle = createStoredS3CoordinatorRuntimeHandler({
    allowedMediaOrigins: [mediaBaseUrl],
    blockingReload: {
      timeoutMs: BLOCKING_TIMEOUT_MS,
      waitForCursor: (context) => notifier.waitForCursor(context),
    },
    bucket: "media",
    client: createPresignOnlyS3Client(),
    cursorNotifier: notifier,
    expiresInSeconds: GRANT_TTL_SECONDS,
    objectClient: createByteStoreHeadClient(byteStore),
    providerId: "s3_primary",
    publicationMode: "read-gated",
    response: manifestOptions.response,
    store: createMemoryCoordinatorStore(),
    ...manifestOptions.manifest,
  });

  const session = {
    createdAt: new Date().toISOString(),
    epoch: 1,
    latencyProfile: profile.latencyProfile,
    olos: "1.0",
    partTarget: profile.partTarget,
    renditions: [
      {
        bitrate: 5_000_000,
        codec: "avc1.640028",
        frameRate: options.fps,
        height: 1080,
        kind: "video",
        renditionId: RENDITION_ID,
        width: 1920,
      },
    ],
    segmentTarget: profile.segmentTarget,
    sessionId: SESSION_ID,
    state: "live",
  } satisfies Session;

  const certDir = await mkdtemp(join(tmpdir(), "olos-bench-cert-"));
  const { certPath, keyPath } = generateSelfSignedCert(certDir);
  const server = serve({
    port: options.port,
    tls: { cert: file(certPath), key: file(keyPath) },
    fetch(request) {
      const key = new URL(request.url).pathname.replace(LEADING_SLASHES, "");
      const bytes = byteStore.get(key);
      return bytes === undefined
        ? new Response("not found", { status: 404 })
        : new Response(bytes, { headers: { "content-type": "video/mp4" } });
    },
  });

  return {
    handle,
    mediaBaseUrl,
    renditionId: RENDITION_ID,
    sessionId: SESSION_ID,
    async createSession() {
      await callHandlerExpectOk(
        handle,
        createSessionRequest(mediaBaseUrl, session),
        "create session"
      );
    },
    publishInit: (bytes) =>
      publishObject(handle, byteStore, {
        commitId: "commit_init",
        duration: INIT_DURATION_SECONDS,
        independent: false,
        kind: "init",
        mediaSequenceNumber: 0,
        slotId: "slot_init",
        bytes,
      }),
    publishPart: ({ bytes, mediaSequenceNumber, partNumber, partSeconds }) => {
      const id = `${mediaSequenceNumber}_p${partNumber}`;
      return publishObject(handle, byteStore, {
        commitId: `commit_${id}`,
        duration: partSeconds,
        independent: true,
        kind: "part",
        mediaSequenceNumber,
        partNumber,
        slotId: `slot_${id}`,
        bytes,
      });
    },
    publishSegment: ({ bytes, mediaSequenceNumber, segmentSeconds }) =>
      publishObject(handle, byteStore, {
        commitId: `commit_${mediaSequenceNumber}`,
        duration: segmentSeconds,
        independent: true,
        kind: "segment",
        mediaSequenceNumber,
        slotId: `slot_${mediaSequenceNumber}`,
        bytes,
      }),
    async stop() {
      server.stop(true);
      await rm(certDir, { force: true, recursive: true });
    },
  };
}
