// The /s3/slots → byteStore.set → /s3/commits dance, with a high-resolution
// stamp around each handler call so callers can read per-stage timings off
// the returned `PublishTimestamps`. Used by createLocalOlos's publishInit /
// publishPart / publishSegment methods.

import { now } from "./config";

const EDGE_URL = "https://edge.example.com";
const MAX_BYTES = 5_000_000;
const WINDOW_SEGMENTS = 6;
const SLOT_TTL_MS = 60_000;
const TRACK_ID = "v1080";
const SESSION_ID = "benchmark_session";

type ObjectKind = "init" | "part" | "segment";

const OBJECT_EXTENSIONS: Record<ObjectKind, string> = {
  init: "mp4",
  part: "m4s",
  segment: "m4s",
};

export interface PublishSpec {
  bytes: Uint8Array;
  commitId: string;
  duration: number;
  independent: boolean;
  kind: ObjectKind;
  partNumber?: number;
  sequenceNumber: number;
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
    handle(jsonRequest(`/sessions/${SESSION_ID}/s3/slots`, slotPayload(spec))),
    `slot ${spec.slotId}`
  );
  const { slot } = (await slotResponse.json()) as {
    slot: { objectKey: string };
  };
  byteStore.set(slot.objectKey, spec.bytes);
  const uploadedAt = now();

  await expectOk(
    handle(
      jsonRequest(`/sessions/${SESSION_ID}/s3/commits`, commitPayload(spec))
    ),
    `commit ${spec.slotId}`
  );
  return { committedAt: now(), uploadedAt };
}

function slotPayload(spec: PublishSpec): Record<string, unknown> {
  return {
    contentType: "video/mp4",
    expiresAt: new Date(Date.now() + SLOT_TTL_MS).toISOString(),
    extension: OBJECT_EXTENSIONS[spec.kind],
    kind: spec.kind,
    maxBytes: MAX_BYTES,
    sequenceNumber: spec.sequenceNumber,
    ...(spec.partNumber === undefined ? {} : { partNumber: spec.partNumber }),
    profile: { duration: spec.duration },
    slotId: spec.slotId,
    trackId: TRACK_ID,
  };
}

function commitPayload(spec: PublishSpec): Record<string, unknown> {
  return {
    commitId: spec.commitId,
    committedAt: new Date().toISOString(),
    maxSegments: WINDOW_SEGMENTS,
    profile: { independent: spec.independent },
    slotId: spec.slotId,
  };
}

export function createSessionRequest(
  deliveryBaseUrl: string,
  session: unknown
): Request {
  return jsonRequest("/sessions", { deliveryBaseUrl, session });
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

export { SESSION_ID, TRACK_ID };
