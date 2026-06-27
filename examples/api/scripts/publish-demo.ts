import {
  commitS3RuntimeUpload,
  issueS3RuntimeUploadGrant,
} from "@arsenstorm/olos/s3";
import type { Byterange, Session } from "@arsenstorm/olos/types";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8787";
const INGEST_KEY = process.env.INGEST_KEY ?? "dev-key";
const MEDIA_ORIGIN = process.env.MEDIA_ORIGIN ?? "https://localhost:8787";
const SESSION_ID = `demo_${Date.now()}`;
const RENDITION_ID = "v1080";
const FIRST_SEGMENT_MSN = 1000;
const PARTS_PER_SEGMENT = 4;
const PART_SECONDS = 0.5;
const SEGMENT_SECONDS = PART_SECONDS * PARTS_PER_SEGMENT;
const PART_BYTES_LENGTH = 4096;
const INIT_BYTES = new Uint8Array(1024);

const ingestHeaders = {
  authorization: `Bearer ${INGEST_KEY}`,
  "content-type": "application/json",
};

interface ObjectFixture {
  byterange?: Byterange;
  bytes: Uint8Array;
  commitId: string;
  contentType: string;
  duration: number;
  independent: boolean;
  kind: "init" | "part" | "segment";
  maxBytes: number;
  mediaSequenceNumber: number;
  objectKey: string;
  partNumber?: number;
  slotId: string;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  await createSession();
  console.log(`session ${SESSION_ID} created`);

  await publish(initObject());
  console.log("init published");

  for (let segmentOffset = 0; segmentOffset < 2; segmentOffset += 1) {
    const msn = FIRST_SEGMENT_MSN + segmentOffset;
    let bytePos = 0;
    for (let pn = 0; pn < PARTS_PER_SEGMENT; pn += 1) {
      const part = partObject(msn, pn, bytePos);
      await publish(part);
      bytePos += part.bytes.length;
    }
    await publish(segmentObject(msn, bytePos));
    console.log(`segment msn=${msn} published (${bytePos}B across 4 parts)`);
  }

  const manifest = await fetchManifest();
  if (!manifest.includes('BYTERANGE="')) {
    throw new Error(`manifest is missing BYTERANGE entries\n${manifest}`);
  }
  console.log("manifest has BYTERANGE entries");

  await runBlockingReload();

  await verifyVirtualSegment();

  console.log("publish-demo finished");
}

async function createSession(): Promise<void> {
  const session: Session = {
    createdAt: new Date().toISOString(),
    epoch: 1,
    latencyProfile: "object-ll",
    olos: "1.0",
    partTarget: PART_SECONDS,
    renditions: [
      {
        bitrate: 5_000_000,
        codec: "avc1.640028",
        frameRate: 30,
        height: 1080,
        kind: "video",
        renditionId: RENDITION_ID,
        width: 1920,
      },
    ],
    segmentTarget: SEGMENT_SECONDS,
    sessionId: SESSION_ID,
    state: "live",
  };

  const response = await fetch(`${BASE_URL}/sessions`, {
    body: JSON.stringify({ mediaBaseUrl: MEDIA_ORIGIN, session }),
    headers: ingestHeaders,
    method: "POST",
  });

  if (response.status !== 201) {
    throw new Error(
      `session create returned ${response.status}: ${await response.text()}`
    );
  }
}

async function publish(object: ObjectFixture): Promise<void> {
  const grant = await issueGrant(object);

  const upload = await fetch(grant.uploadUrl, {
    body: object.bytes,
    headers: grant.requiredHeaders as Record<string, string>,
    method: "PUT",
  });

  if (!upload.ok) {
    throw new Error(
      `upload PUT returned ${upload.status}: ${await upload.text()}`
    );
  }

  await commitObject(object);
}

async function issueGrant(object: ObjectFixture): Promise<{
  requiredHeaders: Record<string, string>;
  uploadUrl: string;
}> {
  const expiresAt = new Date(Date.now() + 10_000).toISOString();
  const result = await issueS3RuntimeUploadGrant({
    baseUrl: BASE_URL,
    fetch: ingestFetch,
    payload: {
      ...(object.byterange === undefined
        ? {}
        : { byterange: object.byterange }),
      contentType: object.contentType,
      deliveryUrl: `${MEDIA_ORIGIN}/media/${object.objectKey}`,
      duration: object.duration,
      expiresAt,
      kind: object.kind,
      maxBytes: object.maxBytes,
      mediaSequenceNumber: object.mediaSequenceNumber,
      objectKey: object.objectKey,
      ...(object.partNumber === undefined
        ? {}
        : { partNumber: object.partNumber }),
      renditionId: RENDITION_ID,
      slotId: object.slotId,
    },
    sessionId: SESSION_ID,
  });

  return {
    requiredHeaders: result.grant.requiredHeaders ?? {},
    uploadUrl: result.grant.url,
  };
}

async function commitObject(object: ObjectFixture): Promise<void> {
  await commitS3RuntimeUpload({
    baseUrl: BASE_URL,
    fetch: ingestFetch,
    payload: {
      commitId: object.commitId,
      committedAt: new Date().toISOString(),
      independent: object.independent,
      objectKey: object.objectKey,
      slotId: object.slotId,
    },
    sessionId: SESSION_ID,
  });
}

async function fetchManifest(): Promise<string> {
  const response = await fetch(
    `${BASE_URL}/v1/live/${SESSION_ID}/${RENDITION_ID}/media.m3u8`
  );

  if (!response.ok) {
    throw new Error(
      `manifest GET returned ${response.status}: ${await response.text()}`
    );
  }

  return await response.text();
}

async function runBlockingReload(): Promise<void> {
  // Open a blocking-reload request one segment ahead of the live edge,
  // then publish the parts that complete that segment concurrently. The
  // request should unblock once those parts land.
  const nextMsn = FIRST_SEGMENT_MSN + 2;
  const blockingUrl =
    `${BASE_URL}/v1/live/${SESSION_ID}/${RENDITION_ID}/media.m3u8` +
    `?_HLS_msn=${nextMsn}`;

  const startedAtMs = Date.now();
  const blockingPromise = fetch(blockingUrl);

  await wait(100);
  let bytePos = 0;
  for (let pn = 0; pn < PARTS_PER_SEGMENT; pn += 1) {
    const part = partObject(nextMsn, pn, bytePos);
    await publish(part);
    bytePos += part.bytes.length;
  }
  await publish(segmentObject(nextMsn, bytePos));

  const blockingResponse = await blockingPromise;
  const elapsedMs = Date.now() - startedAtMs;

  if (!blockingResponse.ok) {
    throw new Error(
      `blocking reload returned ${blockingResponse.status}: ${await blockingResponse.text()}`
    );
  }
  console.log(`blocking reload returned in ${elapsedMs}ms`);
}

async function verifyVirtualSegment(): Promise<void> {
  // Sanity-check the byterange Worker route by asking for the full virtual
  // segment + a small interior Range.
  const msn = FIRST_SEGMENT_MSN;
  const url = `${BASE_URL}/v/${SESSION_ID}/${RENDITION_ID}/${msn}.m4s`;

  const full = await fetch(url);
  if (!full.ok) {
    throw new Error(
      `virtual segment full GET ${full.status}: ${await full.text()}`
    );
  }
  const expectedSize = PARTS_PER_SEGMENT * PART_BYTES_LENGTH;
  const fullBytes = new Uint8Array(await full.arrayBuffer());
  if (fullBytes.length !== expectedSize) {
    throw new Error(
      `virtual segment full size ${fullBytes.length} !== ${expectedSize}`
    );
  }
  console.log(`virtual segment full GET: ${fullBytes.length}B`);

  const range = await fetch(url, {
    headers: { range: "bytes=1000-2999" },
  });
  if (range.status !== 206) {
    throw new Error(
      `virtual segment range GET returned ${range.status}: ${await range.text()}`
    );
  }
  const rangeBytes = new Uint8Array(await range.arrayBuffer());
  if (rangeBytes.length !== 2000) {
    throw new Error(`virtual segment range size ${rangeBytes.length} !== 2000`);
  }
  console.log(`virtual segment Range bytes=1000-2999: ${rangeBytes.length}B`);
}

function initObject(): ObjectFixture {
  return {
    bytes: INIT_BYTES,
    commitId: `${SESSION_ID}_commit_init`,
    contentType: "video/mp4",
    duration: 1,
    independent: false,
    kind: "init",
    maxBytes: 2048,
    mediaSequenceNumber: 0,
    objectKey: `live/${SESSION_ID}/${RENDITION_ID}/init.mp4`,
    slotId: `${SESSION_ID}_slot_init`,
  };
}

function partObject(
  msn: number,
  partNumber: number,
  byterangeOffset: number
): ObjectFixture {
  const bytes = makePartBytes(byterangeOffset, PART_BYTES_LENGTH);
  return {
    byterange: {
      length: bytes.length,
      offset: byterangeOffset,
      segmentDeliveryUrl: `${MEDIA_ORIGIN}/v/${SESSION_ID}/${RENDITION_ID}/${msn}.m4s`,
      segmentObjectKey: `live/${SESSION_ID}/${RENDITION_ID}/${msn}.m4s`,
    },
    bytes,
    commitId: `${SESSION_ID}_commit_${msn}_part_${partNumber}`,
    contentType: "video/mp4",
    duration: PART_SECONDS,
    independent: true,
    kind: "part",
    maxBytes: PART_BYTES_LENGTH,
    mediaSequenceNumber: msn,
    objectKey: `live/${SESSION_ID}/${RENDITION_ID}/${msn}-part-${partNumber}.m4s`,
    partNumber,
    slotId: `${SESSION_ID}_slot_${msn}_part_${partNumber}`,
  };
}

function segmentObject(msn: number, totalBytes: number): ObjectFixture {
  // The segment commit finalizes the byterange parts. Its own bytes are an
  // assembled concatenation; the Worker's /v/ route reads the parts back
  // from S3 rather than this object, so the actual content doesn't matter
  // for the demo — the size just has to be >= the slot's max bytes.
  return {
    bytes: new Uint8Array(totalBytes),
    commitId: `${SESSION_ID}_commit_${msn}`,
    contentType: "video/mp4",
    duration: SEGMENT_SECONDS,
    independent: true,
    kind: "segment",
    maxBytes: totalBytes,
    mediaSequenceNumber: msn,
    objectKey: `live/${SESSION_ID}/${RENDITION_ID}/${msn}.m4s`,
    slotId: `${SESSION_ID}_slot_${msn}`,
  };
}

function makePartBytes(offset: number, length: number): Uint8Array {
  // Deterministic pattern derived from the byterange offset so we can
  // verify Range requests reassemble the right bytes.
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    bytes[i] = (offset + i) % 256;
  }
  return bytes;
}

function ingestFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${INGEST_KEY}`);
  return fetch(input, { ...init, headers });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
