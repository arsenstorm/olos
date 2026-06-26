import type { CoordinatorPipelineStore } from "olos/protocol";
import {
  type ByterangeRangeRequest,
  createByterangeSegmentResponse,
  type S3GetObjectClient,
} from "olos/s3";
import { createCursorWaiter } from "./cursor-notifier";

const VIRTUAL_PATH_PATTERN =
  /^\/v\/(?<sessionId>[^/]+)\/(?<renditionId>[^/]+)\/(?<msn>\d+)\.m4s$/;

const RANGE_HEADER_PATTERN = /^bytes=(\d+)-(\d*)$/;

const BLOCKING_RELOAD_TIMEOUT_MS = 3000;

export async function proxyVirtualSegment(
  request: Request,
  env: Env,
  client: S3GetObjectClient,
  store: CoordinatorPipelineStore
): Promise<Response> {
  const url = new URL(request.url);
  const match = VIRTUAL_PATH_PATTERN.exec(url.pathname);
  if (match?.groups === undefined) {
    return new Response("not found", { status: 404 });
  }

  const { sessionId, renditionId, msn } = match.groups as {
    msn: string;
    renditionId: string;
    sessionId: string;
  };

  const range = parseRangeHeader(request.headers.get("range"));
  if (range === "invalid") {
    return new Response("invalid range", { status: 416 });
  }

  return await createByterangeSegmentResponse({
    bucket: env.S3_BUCKET,
    client,
    cursorWait: createCursorWaiter(env.STREAMS, BLOCKING_RELOAD_TIMEOUT_MS),
    range,
    segmentObjectKey: `live/${sessionId}/${renditionId}/${msn}.m4s`,
    sessionId,
    signal: request.signal,
    store,
    timeoutMs: BLOCKING_RELOAD_TIMEOUT_MS,
  });
}

function parseRangeHeader(
  value: string | null
): ByterangeRangeRequest | undefined | "invalid" {
  if (value === null) {
    return;
  }

  const match = RANGE_HEADER_PATTERN.exec(value);
  if (match === null) {
    return "invalid";
  }

  const start = Number(match[1]);
  const endRaw = match[2];
  if (endRaw === "") {
    return { start };
  }
  return { end: Number(endRaw), start };
}
