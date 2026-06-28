// The benchmark rig: real ffmpeg encode/decode + a local, zero-cost OLOS.
//
// LOCAL ONLY. No R2/S3/AWS, no credentials, no egress. The S3 "client" only
// presigns URLs locally and is never sent to; uploaded bytes live in an
// in-memory Map and are served from a loopback TLS origin on 127.0.0.1. The
// only external processes are local ffmpeg / ffprobe / openssl.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { file, serve } from "bun";
import { createMemoryCoordinatorStore } from "../src/protocol";
import {
  createMemoryRuntimeCursorNotifier,
  createRuntimeObjectLowLatencyManifestOptions,
  createRuntimeObjectLowLatencyProfile,
} from "../src/runtime";
import { createStoredS3CoordinatorRuntimeHandler } from "../src/s3";
import {
  createTestHeadObjectClientFor,
  createTestS3Client,
} from "../src/s3/test-client.test-helper";
import type { Session } from "../src/types";
import { decodeFrame, FRAME_BYTES, HEIGHT, WIDTH } from "./barcode";

const RENDITION_ID = "v1080";
const SESSION_ID = "benchmark_session";
const EDGE_URL = "https://edge.example.com";
const MAX_BYTES = 5_000_000;
const WINDOW_SEGMENTS = 6;
const SLOT_TTL_MS = 60_000;
const GRANT_TTL_SECONDS = 5;
const BLOCKING_TIMEOUT_MS = 5000;
const LEADING_SLASHES = /^\/+/;
const INIT_DURATION_SECONDS = 1;

// --- ffmpeg --------------------------------------------------------------

export interface EncoderOptions {
  crf: number;
  fps: number;
  outDir: string;
  segmentSeconds: number;
}

// Encodes raw barcode frames piped to stdin into a real fMP4 LL-HLS stream
// (init.mp4 + part-NNNNN.m4s + playlist.m3u8) in outDir.
export function spawnEncoder(options: EncoderOptions): ChildProcess {
  return spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-s",
      `${WIDTH}x${HEIGHT}`,
      "-framerate",
      String(options.fps),
      "-i",
      "pipe:0",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-crf",
      String(options.crf),
      "-g",
      String(Math.max(1, Math.round(options.fps * options.segmentSeconds))),
      "-f",
      "hls",
      "-hls_time",
      String(options.segmentSeconds),
      "-hls_segment_type",
      "fmp4",
      "-hls_fmp4_init_filename",
      "init.mp4",
      "-hls_segment_filename",
      join(options.outDir, "part-%05d.m4s"),
      "-hls_flags",
      "+temp_file+independent_segments+split_by_time",
      "-hls_list_size",
      "0",
      "-hls_playlist_type",
      "event",
      join(options.outDir, "playlist.m3u8"),
    ],
    { stdio: ["pipe", "inherit", "inherit"] }
  );
}

// Decodes the first frame of an fMP4 (init + segment, concatenated) and reads
// its barcode. Returns NaN if the frame can't be decoded or read.
export function decodeFirstFrame(mp4: Uint8Array): number {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-",
    ],
    { input: Buffer.from(mp4), maxBuffer: 64 * 1024 * 1024 }
  );
  const out = result.stdout;
  if (!out || out.length < FRAME_BYTES) {
    return Number.NaN;
  }
  return decodeFrame(new Uint8Array(out.buffer, out.byteOffset, FRAME_BYTES));
}

// --- local OLOS ----------------------------------------------------------

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
  publishInit(bytes: Uint8Array): Promise<void>;
  publishPart(options: PublishPartOptions): Promise<void>;
  publishSegment(options: PublishSegmentOptions): Promise<void>;
  renditionId: string;
  sessionId: string;
  stop(): Promise<void>;
}

// Stands up the real OLOS handler backed by an in-memory store + fake S3
// clients, plus a loopback TLS media origin that serves published bytes. The
// handler, the head-object size lookup, and the media origin all read the same
// in-memory byte store, so a published object is immediately serveable.
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
    client: createTestS3Client(),
    cursorNotifier: notifier,
    expiresInSeconds: GRANT_TTL_SECONDS,
    objectClient: createTestHeadObjectClientFor(
      [],
      (objectKey: string) => byteStore.get(objectKey)?.length
    ),
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
      await expectOk(
        handle(jsonRequest("/sessions", { mediaBaseUrl, session })),
        "create session"
      );
    },
    publishInit(bytes) {
      return publishObject(handle, byteStore, {
        commitId: "commit_init",
        duration: INIT_DURATION_SECONDS,
        independent: false,
        kind: "init",
        mediaSequenceNumber: 0,
        slotId: "slot_init",
        bytes,
      });
    },
    publishPart({ bytes, mediaSequenceNumber, partNumber, partSeconds }) {
      const idSuffix = `${mediaSequenceNumber}_p${partNumber}`;
      return publishObject(handle, byteStore, {
        commitId: `commit_${idSuffix}`,
        duration: partSeconds,
        // Encoder runs `-g = fps * partSeconds`, so every part starts on a
        // keyframe — every part is independently decodable.
        independent: true,
        kind: "part",
        mediaSequenceNumber,
        partNumber,
        slotId: `slot_${idSuffix}`,
        bytes,
      });
    },
    publishSegment({ bytes, mediaSequenceNumber, segmentSeconds }) {
      return publishObject(handle, byteStore, {
        commitId: `commit_${mediaSequenceNumber}`,
        duration: segmentSeconds,
        independent: true,
        kind: "segment",
        mediaSequenceNumber,
        slotId: `slot_${mediaSequenceNumber}`,
        bytes,
      });
    },
    async stop() {
      server.stop(true);
      await rm(certDir, { force: true, recursive: true });
    },
  };
}

interface PublishSpec {
  bytes: Uint8Array;
  commitId: string;
  duration: number;
  independent: boolean;
  kind: "init" | "part" | "segment";
  mediaSequenceNumber: number;
  partNumber?: number;
  slotId: string;
}

async function publishObject(
  handle: (request: Request) => Promise<Response>,
  byteStore: Map<string, Uint8Array>,
  spec: PublishSpec
): Promise<void> {
  const slotResponse = await expectOk(
    handle(
      jsonRequest(`/sessions/${SESSION_ID}/s3/slots`, {
        contentType: "video/mp4",
        duration: spec.duration,
        expiresAt: new Date(Date.now() + SLOT_TTL_MS).toISOString(),
        kind: spec.kind,
        maxBytes: MAX_BYTES,
        mediaSequenceNumber: spec.mediaSequenceNumber,
        ...(spec.partNumber === undefined
          ? {}
          : { partNumber: spec.partNumber }),
        renditionId: RENDITION_ID,
        slotId: spec.slotId,
      })
    ),
    `slot ${spec.slotId}`
  );
  const { slot } = (await slotResponse.json()) as {
    slot: { objectKey: string };
  };
  byteStore.set(slot.objectKey, spec.bytes);

  await expectOk(
    handle(
      jsonRequest(`/sessions/${SESSION_ID}/s3/commits`, {
        commitId: spec.commitId,
        committedAt: new Date().toISOString(),
        independent: spec.independent,
        maxSegments: WINDOW_SEGMENTS,
        slotId: spec.slotId,
      })
    ),
    `commit ${spec.slotId}`
  );
}

// --- internals -----------------------------------------------------------

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`${EDGE_URL}${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function expectOk(
  response: Promise<Response>,
  label: string
): Promise<Response> {
  const result = await response;
  if (result.status >= 300) {
    throw new Error(`${label} → ${result.status}: ${await result.text()}`);
  }
  return result;
}

function assertLoopback(mediaBaseUrl: string): void {
  const host = new URL(mediaBaseUrl).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(
      `benchmark is local-only; media origin must be loopback, got ${host}`
    );
  }
}

function generateSelfSignedCert(dir: string): {
  certPath: string;
  keyPath: string;
} {
  const certPath = join(dir, "cert.pem");
  const keyPath = join(dir, "key.pem");
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" }
  );
  if (result.status !== 0) {
    throw new Error("openssl failed to generate a self-signed cert");
  }
  return { certPath, keyPath };
}
