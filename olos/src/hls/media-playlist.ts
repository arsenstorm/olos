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

export interface RenderMediaPlaylistOptions extends MediaUriPolicy {
  partHoldBack?: number;
  partTarget: number;
  renditionId: string;
  segmentTarget: number;
  targetLatency?: number;
}

type FullCommittedSegment = CommittedSegment & {
  segment: CommittedObject;
};

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

  const { partHoldBack, targetLatency } = resolveHoldBackOptions(options);
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:10",
    `#EXT-X-TARGETDURATION:${Math.ceil(options.segmentTarget)}`,
    `#EXT-X-PART-INF:PART-TARGET=${formatSeconds(options.partTarget)}`,
    `#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=${formatSeconds(partHoldBack)},HOLD-BACK=${formatSeconds(targetLatency)}`,
    `#EXT-X-MEDIA-SEQUENCE:${committedWindow.firstMediaSequenceNumber}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${committedWindow.discontinuitySequence}`,
    `#EXT-X-MAP:URI="${renderMediaUri(rendition.init.deliveryUrl, options, "rendition.init.deliveryUrl")}"`,
    "",
  ];

  for (const segment of rendition.segments) {
    lines.push(...renderSegment(segment, options));
  }

  return `${lines.join("\n")}\n`;
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
  return (segment.parts ?? []).map((part) => renderPart(part, policy));
}

function hasFullCommittedSegment(
  segment: CommittedSegment
): segment is FullCommittedSegment {
  return segment.segment !== undefined;
}

function renderPart(part: CommittedPart, policy: MediaUriPolicy): string {
  const attributes = [
    `DURATION=${formatSeconds(part.duration)}`,
    part.independent ? "INDEPENDENT=YES" : undefined,
    `URI="${renderMediaUri(part.deliveryUrl, policy, "part.deliveryUrl")}"`,
  ].filter((attribute) => attribute !== undefined);

  return `#EXT-X-PART:${attributes.join(",")}`;
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
