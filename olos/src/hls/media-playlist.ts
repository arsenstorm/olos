import type {
  CommittedObject,
  CommittedPart,
  CommittedSegment,
  CommittedWindow,
} from "../types/committed-window";
import { assertCommittedWindow } from "../validation/committed-window";
import { positiveNumber } from "../validation/fields";
import { escapePlaylistValue, formatSeconds } from "./format";
import { assertSafeMediaUri, type MediaUriPolicy } from "./uri";

/** Options for `renderMediaPlaylist`. */
export interface RenderMediaPlaylistOptions extends MediaUriPolicy {
  /**
   * Append `#EXT-X-ENDLIST` so players stop polling. Callers set this when
   * the session is in a terminal state (`ended` or `aborted`); the
   * manifest-artifact helpers default it from the session or cursor state.
   * Defaults to `false`.
   */
  endOfStream?: boolean;
  /**
   * `PART-HOLD-BACK` in seconds. Defaults to
   * `max(3 * partTarget, targetLatency)`; explicit values below
   * `3 * partTarget` are rejected.
   */
  partHoldBack?: number;
  /** Target part duration in seconds (`PART-TARGET`). */
  partTarget: number;
  /** The committed-window rendition to render. */
  renditionId: string;
  /** Target segment duration in seconds (`EXT-X-TARGETDURATION`). */
  segmentTarget: number;
  /** `HOLD-BACK` in seconds. Defaults to `3`. */
  targetLatency?: number;
}

type FullCommittedSegment = CommittedSegment & {
  segment: CommittedObject;
};

/**
 * Renders one rendition's LL-HLS media playlist from the committed window:
 * server-control headers advertising `CAN-BLOCK-RELOAD=YES`, the init-segment
 * `#EXT-X-MAP`, full segments as `#EXTINF` entries, in-progress segments as
 * `#EXT-X-PART` entries with a `#EXT-X-PRELOAD-HINT` when the last committed
 * part uses byterange addressing, and a closing `#EXT-X-ENDLIST` when
 * `options.endOfStream` is set (terminal sessions). Throws when the window
 * is malformed, `renditionId` is not in the window, or the target/hold-back
 * options are invalid.
 */
export function renderMediaPlaylist(
  committedWindow: CommittedWindow,
  options: RenderMediaPlaylistOptions
): string {
  assertCommittedWindow(committedWindow);
  positiveNumber(options.partTarget, "options.partTarget");
  positiveNumber(options.segmentTarget, "options.segmentTarget");

  const rendition = committedWindow.renditions[options.renditionId];

  if (!rendition) {
    throw new Error(`rendition not found: ${options.renditionId}`);
  }

  const lines = renderMediaPlaylistHeaders(committedWindow, options, rendition);

  for (const segment of rendition.segments) {
    lines.push(...renderSegment(segment, options));
  }

  if (options.endOfStream) {
    // Terminal sessions close the playlist with EXT-X-ENDLIST so players
    // stop polling. EXT-X-PLAYLIST-TYPE is deliberately omitted: this is
    // still a sliding window (old segments fall off), which VOD/EVENT
    // playlist types forbid.
    lines.push("#EXT-X-ENDLIST");
  }

  return `${lines.join("\n")}\n`;
}

function renderMediaPlaylistHeaders(
  committedWindow: CommittedWindow,
  options: RenderMediaPlaylistOptions,
  rendition: CommittedWindow["renditions"][string]
): string[] {
  const { partHoldBack, targetLatency } = resolveHoldBackOptions(options);

  return [
    "#EXTM3U",
    "#EXT-X-VERSION:10",
    `#EXT-X-TARGETDURATION:${Math.ceil(options.segmentTarget)}`,
    `#EXT-X-PART-INF:PART-TARGET=${formatSeconds(options.partTarget)}`,
    `#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=${formatSeconds(partHoldBack)},HOLD-BACK=${formatSeconds(targetLatency)}`,
    // The declared media sequence must match this rendition's first #EXTINF
    // entry — renditions can diverge from the window-global minimum when
    // per-rendition trimming or empty-media segments drop leading segments.
    `#EXT-X-MEDIA-SEQUENCE:${rendition.segments[0]?.mediaSequenceNumber ?? committedWindow.firstMediaSequenceNumber}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${committedWindow.discontinuitySequence}`,
    `#EXT-X-MAP:URI="${renderMediaUri(rendition.init.deliveryUrl, options, "rendition.init.deliveryUrl")}"`,
    "",
  ];
}

function renderSegment(
  segment: CommittedSegment,
  policy: MediaUriPolicy
): string[] {
  const lines = renderSegmentHeaders(segment);

  if (hasFullCommittedSegment(segment)) {
    return [...lines, ...renderFullSegment(segment, policy)];
  }

  return [...lines, ...renderPartialSegment(segment, policy)];
}

function renderSegmentHeaders(segment: CommittedSegment): string[] {
  const lines: string[] = [];

  if (segment.discontinuityBefore) {
    lines.push("#EXT-X-DISCONTINUITY");
  }

  if (segment.programDateTime) {
    lines.push(`#EXT-X-PROGRAM-DATE-TIME:${segment.programDateTime}`);
  }

  return lines;
}

function renderFullSegment(
  segment: FullCommittedSegment,
  policy: MediaUriPolicy
): string[] {
  return [
    `#EXTINF:${formatSeconds(segment.duration)},`,
    renderMediaUri(segment.segment.deliveryUrl, policy, "segment.deliveryUrl"),
  ];
}

function renderPartialSegment(
  segment: CommittedSegment,
  policy: MediaUriPolicy
): string[] {
  const parts = segment.parts ?? [];
  const lines = parts.map((part) => renderPart(part, policy));

  const preloadHint = renderPreloadHint(parts, policy);
  if (preloadHint !== undefined) {
    lines.push(preloadHint);
  }

  return lines;
}

function hasFullCommittedSegment(
  segment: CommittedSegment
): segment is FullCommittedSegment {
  return segment.segment !== undefined;
}

function renderPart(part: CommittedPart, policy: MediaUriPolicy): string {
  return `#EXT-X-PART:${partAttributes(part, policy).join(",")}`;
}

function partAttributes(part: CommittedPart, policy: MediaUriPolicy): string[] {
  const { byterange } = part;
  const uri = byterange?.segmentDeliveryUrl ?? part.deliveryUrl;
  const uriField = byterange
    ? "part.byterange.segmentDeliveryUrl"
    : "part.deliveryUrl";

  return [
    `DURATION=${formatSeconds(part.duration)}`,
    part.independent ? "INDEPENDENT=YES" : undefined,
    `URI="${renderMediaUri(uri, policy, uriField)}"`,
    byterange
      ? `BYTERANGE="${byterange.length}@${byterange.offset}"`
      : undefined,
  ].filter((attribute) => attribute !== undefined);
}

/**
 * `#EXT-X-PRELOAD-HINT:TYPE=PART` tells the player the byte offset at which
 * the next part will land, so it can hold a Range request open and receive
 * the bytes as soon as the streamer commits them. Only emitted when the last
 * committed part of the in-progress segment uses byterange addressing — for
 * per-part-URI sessions there's nothing to preload-hint at.
 */
function renderPreloadHint(
  parts: readonly CommittedPart[],
  policy: MediaUriPolicy
): string | undefined {
  if (parts.length === 0) {
    return;
  }

  const lastPart = parts.at(-1);
  if (lastPart?.byterange === undefined) {
    return;
  }

  const { length, offset, segmentDeliveryUrl } = lastPart.byterange;
  const uri = renderMediaUri(
    segmentDeliveryUrl,
    policy,
    "part.byterange.segmentDeliveryUrl"
  );
  return `#EXT-X-PRELOAD-HINT:TYPE=PART,URI="${uri}",BYTERANGE-START=${offset + length}`;
}

function renderMediaUri(
  value: string,
  policy: MediaUriPolicy,
  name: string
): string {
  assertSafeMediaUri(value, policy, name);
  return escapePlaylistValue(value);
}

function resolveHoldBackOptions(options: RenderMediaPlaylistOptions): {
  partHoldBack: number;
  targetLatency: number;
} {
  const targetLatency = options.targetLatency ?? 3;
  positiveNumber(targetLatency, "options.targetLatency");

  const minimumPartHoldBack = 3 * options.partTarget;
  const partHoldBack =
    options.partHoldBack ?? Math.max(minimumPartHoldBack, targetLatency);
  positiveNumber(partHoldBack, "options.partHoldBack");

  if (partHoldBack < minimumPartHoldBack) {
    throw new Error(
      "options.partHoldBack must be at least three times options.partTarget"
    );
  }

  return { partHoldBack, targetLatency };
}
