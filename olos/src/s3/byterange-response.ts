import { resolveCommittedParts } from "./byterange-parts";
import { createByterangeStream } from "./byterange-stream";
import {
  type ByterangeRangeRequest,
  type CreateByterangeSegmentResponseOptions,
  OPEN_ENDED_LAST_BYTE_POS,
} from "./byterange-types";

/**
 * Serve a Range request against the virtual segment identified by
 * `segmentObjectKey`. The helper looks up the part commits in OLOS's
 * coordinator state, fetches each part's S3 object, and streams the requested
 * bytes. If the requested range extends past the committed parts, the helper
 * blocks on `cursorWait` until the next commit lands, then continues — the
 * mechanism that makes `EXT-X-PRELOAD-HINT` deliver bytes as soon as the
 * streamer publishes them.
 *
 * Bounded ranges (`range.end` set) are served as 206 with a `content-range`
 * and `content-length`; if the committed parts run out before the promised
 * end, the stream errors rather than closing short. Open-ended requests
 * (no `range.end`, any offset) stream a live aggregate of unknown total
 * length; any request that carried a Range header is a 206 (RFC 8673, with
 * a very-large last-byte-pos in `content-range` and no `content-length`),
 * and only rangeless requests are a plain 200.
 */
export async function createByterangeSegmentResponse(
  options: CreateByterangeSegmentResponseOptions
): Promise<Response> {
  const requested = options.range ?? { start: 0 };
  if (!isSatisfiableRange(requested)) {
    return new Response("invalid range", { status: 416 });
  }

  const range = normalizeRange(requested);
  const initial = await resolveCommittedParts(
    options.store,
    options.sessionId,
    options.segmentObjectKey
  );
  if (initial === undefined) {
    return new Response("not found", { status: 404 });
  }

  const body = createByterangeStream(options, initial, range);

  if (options.range === undefined) {
    return new Response(body, { headers: baseHeaders(), status: 200 });
  }

  return new Response(body, { headers: rangeHeaders(range), status: 206 });
}

function isSatisfiableRange(range: ByterangeRangeRequest): boolean {
  if (range.start < 0) {
    return false;
  }
  return range.end === undefined || range.end >= range.start;
}

/**
 * A bounded end at or past the open-ended sentinel is a client spelling out
 * RFC 8673's "very large value"; normalize it to an open-ended range.
 */
function normalizeRange(range: ByterangeRangeRequest): ByterangeRangeRequest {
  if (range.end !== undefined && range.end >= OPEN_ENDED_LAST_BYTE_POS) {
    return { start: range.start };
  }
  return range;
}

function baseHeaders(): Headers {
  return new Headers({
    "accept-ranges": "bytes",
    "cache-control": "no-store",
    "content-type": "video/mp4",
  });
}

/** Headers for a 206 answer to a request that carried a Range header. */
function rangeHeaders(range: ByterangeRangeRequest): Headers {
  const headers = baseHeaders();

  if (range.end !== undefined) {
    headers.set("content-range", `bytes ${range.start}-${range.end}/*`);
    headers.set("content-length", String(range.end - range.start + 1));
    return headers;
  }

  // RFC 8673 §2: an open-ended live range answers with a very large
  // last-byte-pos and no content-length; the body streams to the live edge
  // and a clean close marks the end of the available content.
  headers.set(
    "content-range",
    `bytes ${range.start}-${OPEN_ENDED_LAST_BYTE_POS}/*`
  );
  return headers;
}
