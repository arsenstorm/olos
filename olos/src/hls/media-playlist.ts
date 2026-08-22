import type { MediaTrackWindowProfile } from "../media/types";
import {
  mediaObjectProfile,
  mediaSegmentDiscontinuityBefore,
  mediaSegmentDuration,
  mediaSegmentProgramDateTime,
} from "../media/validation";
import type {
  CommittedObject,
  CommittedPart,
  CommittedSegment,
  CommittedWindow,
  TrackWindow,
} from "../types/committed-window";
import { assertCommittedWindow } from "../validation/committed-window";
import {
  booleanValue,
  nonNegativeNumber,
  positiveNumber,
} from "../validation/fields";
import { formatSeconds, quotedPlaylistValue } from "./format";
import { assertSafeMediaUri, type MediaUriPolicy } from "./uri";

/** Options for `renderMediaPlaylist`. */
export interface RenderMediaPlaylistOptions extends MediaUriPolicy {
  /**
   * Advertise `CAN-BLOCK-RELOAD=YES`. Set `false` when the server does not
   * hold `_HLS_msn` / `_HLS_part` requests open; defaults to `true`.
   */
  canBlockReload?: boolean;
  /**
   * Baseline `EXT-X-DISCONTINUITY-SEQUENCE` (the media session profile's
   * `discontinuitySequence`). A track window whose profile carries its own
   * `discontinuitySequence` (trimmed discontinuities) takes precedence.
   * Defaults to `0`.
   */
  discontinuitySequence?: number;
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
  /** Target segment duration in seconds (`EXT-X-TARGETDURATION`). */
  segmentTarget: number;
  /**
   * The deployment's target latency in seconds. Defaults to `3`. `HOLD-BACK`
   * is rendered as `max(3 * ceil(segmentTarget), targetLatency)`: RFC 8216bis
   * floors the tag at three target durations, and Apple's player rejects the
   * playlist outright below it.
   */
  targetLatency?: number;
  /** The committed-window track to render. */
  trackId: string;
}

type FullCommittedSegment = CommittedSegment & {
  segment: CommittedObject;
};

/**
 * Renders one track's LL-HLS media playlist from the committed window:
 * server-control headers advertising `CAN-BLOCK-RELOAD=YES` (unless
 * `options.canBlockReload` is `false`), the init-segment `#EXT-X-MAP`, full
 * segments as `#EXTINF` entries (with their `#EXT-X-PART` lines retained
 * until the segment is at least three target durations from the end of the
 * playlist, RFC 8216bis Section 6.2.2), in-progress segments as
 * `#EXT-X-PART` entries with a `#EXT-X-PRELOAD-HINT` when the last committed
 * part uses byterange addressing, and a closing `#EXT-X-ENDLIST` when
 * `options.endOfStream` is set (terminal sessions). Durations, independence,
 * program date-times, and discontinuity flags are read from the objects'
 * CMAF/LL-HLS profile data. Throws when the window is malformed, `trackId`
 * is not in the window, the track has no init object, or the
 * target/hold-back options are invalid.
 */
export function renderMediaPlaylist(
  committedWindow: CommittedWindow,
  options: RenderMediaPlaylistOptions
): string {
  assertCommittedWindow(committedWindow);
  positiveNumber(options.partTarget, "options.partTarget");
  positiveNumber(options.segmentTarget, "options.segmentTarget");

  const track = committedWindow.tracks[options.trackId];

  if (!track) {
    throw new Error(`track not found: ${options.trackId}`);
  }

  const targetDuration = Math.ceil(options.segmentTarget);
  const retainWithinSeconds = 3 * targetDuration;
  const lines = renderMediaPlaylistHeaders(committedWindow, options, track);
  const rendered: string[][] = [];
  let distanceFromEnd = 0;

  for (let index = track.segments.length - 1; index >= 0; index -= 1) {
    const segment = track.segments[index] as CommittedSegment;
    rendered.unshift(
      renderSegment(
        segment,
        options,
        distanceFromEnd < retainWithinSeconds ? (segment.parts ?? []) : []
      )
    );
    distanceFromEnd += mediaSegmentDuration(segment);
  }

  lines.push(...rendered.flat());

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
  track: TrackWindow
): string[] {
  const { holdBack, partHoldBack } = resolveHoldBackOptions(options);

  return [
    "#EXTM3U",
    "#EXT-X-VERSION:10",
    `#EXT-X-TARGETDURATION:${Math.ceil(options.segmentTarget)}`,
    `#EXT-X-PART-INF:PART-TARGET=${formatSeconds(options.partTarget)}`,
    renderServerControl(options, partHoldBack, holdBack),
    // The declared media sequence must match this track's first #EXTINF
    // entry — tracks can diverge from the window-global minimum when
    // per-track trimming or empty-media segments drop leading segments.
    `#EXT-X-MEDIA-SEQUENCE:${track.segments[0]?.sequenceNumber ?? committedWindow.firstSequenceNumber}`,
    // Like the media sequence, the discontinuity sequence is per-track:
    // a track that trimmed a flagged segment counts it in its window
    // profile while other tracks keep the session baseline.
    `#EXT-X-DISCONTINUITY-SEQUENCE:${resolveDiscontinuitySequence(track, options)}`,
    `#EXT-X-MAP:URI="${renderMediaUri(requiredInit(track).deliveryUrl, options, "track.init.deliveryUrl")}"`,
    "",
  ];
}

// RFC 8216bis Section 4.4.3.8: CAN-BLOCK-RELOAD=YES MUST only be advertised
// when the server implements blocking reload (Section 8.6 of the spec);
// absent means NO, so it is simply omitted rather than emitted as NO.
function renderServerControl(
  options: RenderMediaPlaylistOptions,
  partHoldBack: number,
  holdBack: number
): string {
  const attributes = [
    resolveCanBlockReload(options) ? "CAN-BLOCK-RELOAD=YES" : undefined,
    `PART-HOLD-BACK=${formatSeconds(partHoldBack)}`,
    `HOLD-BACK=${formatSeconds(holdBack)}`,
  ].filter((attribute) => attribute !== undefined);

  return `#EXT-X-SERVER-CONTROL:${attributes.join(",")}`;
}

function resolveCanBlockReload(options: RenderMediaPlaylistOptions): boolean {
  if (options.canBlockReload === undefined) {
    return true;
  }

  return booleanValue(options.canBlockReload, "options.canBlockReload");
}

// EXT-X-MAP is mandatory for CMAF playback: Core allows tracks without an
// init object, but an HLS playlist cannot be rendered for one.
function requiredInit(track: TrackWindow): CommittedObject {
  if (track.init === undefined) {
    throw new Error(`track ${track.trackId} has no init object`);
  }

  return track.init;
}

function resolveDiscontinuitySequence(
  track: TrackWindow,
  options: RenderMediaPlaylistOptions
): number {
  const trackProfile = track.profile as MediaTrackWindowProfile | undefined;
  const baseline = options.discontinuitySequence ?? 0;
  nonNegativeNumber(baseline, "options.discontinuitySequence");

  return trackProfile?.discontinuitySequence ?? baseline;
}

function renderSegment(
  segment: CommittedSegment,
  policy: MediaUriPolicy,
  retainedParts: readonly CommittedPart[]
): string[] {
  const lines = renderSegmentHeaders(segment);

  if (hasFullCommittedSegment(segment)) {
    return [...lines, ...renderFullSegment(segment, policy, retainedParts)];
  }

  return [...lines, ...renderPartialSegment(segment, policy)];
}

function renderSegmentHeaders(segment: CommittedSegment): string[] {
  const lines: string[] = [];

  if (mediaSegmentDiscontinuityBefore(segment)) {
    lines.push("#EXT-X-DISCONTINUITY");
  }

  const programDateTime = mediaSegmentProgramDateTime(segment);

  if (programDateTime !== undefined) {
    lines.push(`#EXT-X-PROGRAM-DATE-TIME:${programDateTime}`);
  }

  return lines;
}

// RFC 8216bis Section 6.2.2: a completed segment's parts stay in the
// playlist until the segment is at least three target durations from the
// end. Retained parts render before the EXTINF entry, with no preload
// hint — that only applies to the in-progress parts-only segment.
function renderFullSegment(
  segment: FullCommittedSegment,
  policy: MediaUriPolicy,
  retainedParts: readonly CommittedPart[]
): string[] {
  return [
    ...retainedParts.map((part) => renderPart(part, policy)),
    `#EXTINF:${formatSeconds(mediaSegmentDuration(segment))},`,
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
  const { duration, independent } = mediaObjectProfile(part);
  const uri = byterange?.segmentDeliveryUrl ?? part.deliveryUrl;
  const uriField = byterange
    ? "part.byterange.segmentDeliveryUrl"
    : "part.deliveryUrl";

  if (duration === undefined) {
    throw new Error(`part ${part.partNumber} has no media duration`);
  }

  return [
    `DURATION=${formatSeconds(duration)}`,
    independent ? "INDEPENDENT=YES" : undefined,
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
  return quotedPlaylistValue(value, name);
}

function resolveHoldBackOptions(options: RenderMediaPlaylistOptions): {
  holdBack: number;
  partHoldBack: number;
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

  // RFC 8216bis §4.4.3.8: HOLD-BACK MUST be >= 3 × target duration. Raised
  // rather than rejected because targetLatency is a latency goal, not the
  // wire tag; below the floor Apple's player rejects the playlist (CoreMedia -12646).
  const holdBack = Math.max(
    3 * Math.ceil(options.segmentTarget),
    targetLatency
  );

  return { holdBack, partHoldBack };
}
