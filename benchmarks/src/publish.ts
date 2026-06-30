// The /s3/slots → byteStore.set → /s3/commits dance, with a high-resolution
// stamp around each handler call so callers can read per-stage timings off
// the returned `PublishTimestamps`. Used by createLocalOlos's publishInit /
// publishPart / publishSegment methods.

import { now } from "./config";

const EDGE_URL = "https://edge.example.com";
const MAX_BYTES = 5_000_000;
const WINDOW_SEGMENTS = 6;
const SLOT_TTL_MS = 60_000;
const RENDITION_ID = "v1080";
const SESSION_ID = "benchmark_session";

export interface PublishSpec {
  bytes: Uint8Array;
  commitId: string;
  duration: number;
  independent: boolean;
  kind: "init" | "part" | "segment";
  mediaSequenceNumber: number;
  partNumber?: number;
  slotId: string;
}

export interface PublishTimestamps {
  committedAt: number;
  uploadedAt: number;
}

export async function publishObject(
  handle: (request: Request) => Promise<Response>,
  byteStore: Map<string, Uint8Array>,
  spec: PublishSpec
): Promise<PublishTimestamps> {
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
  const uploadedAt = now();

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
  return { uploadedAt, committedAt: now() };
}

export function createSessionRequest(
  mediaBaseUrl: string,
  session: unknown
): Request {
  return jsonRequest("/sessions", { mediaBaseUrl, session });
}

export function callHandlerExpectOk(
  handler: (req: Request) => Promise<Response>,
  request: Request,
  label: string
): Promise<Response> {
  return expectOk(handler(request), label);
}

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

export { RENDITION_ID, SESSION_ID };
