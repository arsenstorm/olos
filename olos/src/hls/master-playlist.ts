import type { Rendition, Session } from "../types/session";
import { isUrlSafeIdentifier } from "../validation/ids";
import { escapePlaylistValue, formatFrameRate } from "./format";
import { assertSafeRelativePath } from "./uri";

/** Options for `renderMasterPlaylist`. */
export interface RenderMasterPlaylistOptions {
  /**
   * When set, only video and grouped-audio renditions whose id is in this
   * set render as variants or `#EXT-X-MEDIA` entries — typically the
   * rendition ids present in the committed window, so the master only
   * advertises playlists that resolve. Ungrouped (muxed) audio renditions
   * are codec metadata and are never filtered. Omitted, every session
   * rendition renders.
   */
  availableRenditionIds?: readonly string[];
  /**
   * Maps a rendition to the media playlist path written into the playlist.
   * Defaults to `/v1/live/{sessionId}/{renditionId}/media.m3u8`. Paths must
   * be safe root-relative paths.
   */
  mediaPlaylistPath?: (session: Session, rendition: Rendition) => string;
}

type AudioRendition = Rendition & { kind: "audio" };
type GroupedAudioRendition = AudioRendition & { groupId: string };
type VideoRendition = Rendition & { kind: "video" };

interface AudioGroup {
  defaultRenditionId: string;
  groupId: string;
  renditions: readonly GroupedAudioRendition[];
}

interface MasterPlaylistRenditions {
  audioGroup?: AudioGroup;
  variantAudioCodecs: readonly string[];
  videoRenditions: readonly VideoRendition[];
}

/**
 * Renders the session's master (multivariant) playlist with one
 * `#EXT-X-STREAM-INF` entry per video rendition. Audio renditions that
 * declare a `groupId` render as selectable `#EXT-X-MEDIA` entries and the
 * variants reference the group through their `AUDIO` attribute; without
 * group IDs, every audio codec is folded into every variant's `CODECS`
 * attribute (legacy muxed audio) and no `#EXT-X-MEDIA` lines are emitted.
 * `availableRenditionIds` narrows the rendered set (session shape and
 * grouping rules are still validated against the full session first).
 * Throws when the session shape is invalid, there is no video rendition, a
 * video rendition lacks `bitrate` or defines only one of `width`/`height`,
 * grouped and ungrouped audio renditions are mixed, more than one audio
 * group is declared, or the filter removes every video rendition.
 */
export function renderMasterPlaylist(
  session: Session,
  options: RenderMasterPlaylistOptions = {}
): string {
  assertSessionShape(session);

  const renditions = masterPlaylistRenditions(
    session,
    options.availableRenditionIds
  );
  const mediaPlaylistPath =
    options.mediaPlaylistPath ?? defaultMediaPlaylistPath;
  const lines = ["#EXTM3U", "#EXT-X-VERSION:10", "#EXT-X-INDEPENDENT-SEGMENTS"];

  lines.push(
    ...renderAudioGroupEntries(session, renditions, mediaPlaylistPath)
  );

  for (const rendition of renditions.videoRenditions) {
    lines.push(
      ...renderVariantEntry(session, rendition, renditions, mediaPlaylistPath)
    );
  }

  return `${lines.join("\n")}\n`;
}

function masterPlaylistRenditions(
  session: Session,
  availableRenditionIds?: readonly string[]
): MasterPlaylistRenditions {
  const audioRenditions = session.renditions.filter(isAudioRendition);
  const videoRenditions = session.renditions.filter(isVideoRendition);

  if (videoRenditions.length === 0) {
    throw new Error(
      "session.renditions must include at least one video rendition"
    );
  }

  // Grouping rules are validated against the full session; the availability
  // filter below only narrows what renders.
  const audioGroup = resolveAudioGroup(audioRenditions);

  if (availableRenditionIds === undefined) {
    return {
      audioGroup,
      variantAudioCodecs: audioGroup
        ? distinct(audioGroup.renditions.map((rendition) => rendition.codec))
        : audioRenditions.map((rendition) => rendition.codec),
      videoRenditions,
    };
  }

  const available = new Set(availableRenditionIds);
  const availableVideoRenditions = videoRenditions.filter((rendition) =>
    available.has(rendition.renditionId)
  );

  if (availableVideoRenditions.length === 0) {
    throw new Error("no video rendition is available to render");
  }

  const availableAudioGroup = filterAudioGroup(audioGroup, available);

  return {
    audioGroup: availableAudioGroup,
    variantAudioCodecs: resolveVariantAudioCodecs(
      audioGroup,
      availableAudioGroup,
      audioRenditions
    ),
    videoRenditions: availableVideoRenditions,
  };
}

// Grouped audio renditions absent from the availability set are dropped and
// DEFAULT is re-elected among the survivors; a group with no survivors is
// not advertised at all. Ungrouped (muxed) audio renditions describe codecs
// inside the video segments, so they are never filtered.
function filterAudioGroup(
  group: AudioGroup | undefined,
  available: ReadonlySet<string>
): AudioGroup | undefined {
  if (group === undefined) {
    return;
  }

  const renditions = group.renditions.filter((rendition) =>
    available.has(rendition.renditionId)
  );
  const [first] = renditions;

  if (first === undefined) {
    return;
  }

  const defaultRendition =
    renditions.find((rendition) => rendition.defaultRendition === true) ??
    first;

  return {
    defaultRenditionId: defaultRendition.renditionId,
    groupId: group.groupId,
    renditions,
  };
}

function resolveVariantAudioCodecs(
  audioGroup: AudioGroup | undefined,
  availableAudioGroup: AudioGroup | undefined,
  audioRenditions: readonly AudioRendition[]
): readonly string[] {
  if (audioGroup === undefined) {
    return audioRenditions.map((rendition) => rendition.codec);
  }

  return availableAudioGroup === undefined
    ? []
    : distinct(availableAudioGroup.renditions.map((r) => r.codec));
}

// Sessions without audio group IDs keep the legacy rendering: every audio
// codec muxed into every variant's CODECS attribute and no EXT-X-MEDIA lines.
// Once any audio rendition declares a groupId, all of them must (mixed
// sessions are rejected) and the group renders as selectable EXT-X-MEDIA
// entries referenced by the variants' AUDIO attribute.
function resolveAudioGroup(
  audioRenditions: readonly AudioRendition[]
): AudioGroup | undefined {
  const grouped = audioRenditions.filter(isGroupedAudioRendition);
  const [first] = grouped;

  if (first === undefined) {
    return;
  }

  if (grouped.length !== audioRenditions.length) {
    throw new Error(
      "session.renditions must not mix grouped and ungrouped audio renditions"
    );
  }

  if (distinct(grouped.map((rendition) => rendition.groupId)).length > 1) {
    throw new Error("multiple audio groups are not supported");
  }

  const defaultRendition =
    grouped.find((rendition) => rendition.defaultRendition === true) ?? first;

  return {
    defaultRenditionId: defaultRendition.renditionId,
    groupId: first.groupId,
    renditions: grouped,
  };
}

function renderAudioGroupEntries(
  session: Session,
  renditions: MasterPlaylistRenditions,
  mediaPlaylistPath: (session: Session, rendition: Rendition) => string
): string[] {
  const group = renditions.audioGroup;

  if (group === undefined) {
    return [];
  }

  return group.renditions.map((rendition) =>
    renderAudioMediaEntry(session, rendition, group, mediaPlaylistPath)
  );
}

function renderAudioMediaEntry(
  session: Session,
  rendition: GroupedAudioRendition,
  group: AudioGroup,
  mediaPlaylistPath: (session: Session, rendition: Rendition) => string
): string {
  const path = mediaPlaylistPath(session, rendition);
  assertSafeRelativePath(path, "media playlist path");

  const attributes = [
    "TYPE=AUDIO",
    `GROUP-ID="${escapePlaylistValue(group.groupId)}"`,
    `NAME="${escapePlaylistValue(rendition.name ?? rendition.renditionId)}"`,
    `DEFAULT=${rendition.renditionId === group.defaultRenditionId ? "YES" : "NO"}`,
    // RFC 8216 §4.3.4.1.1: AUTOSELECT=YES members of a group must be
    // distinct on LANGUAGE/ASSOC-LANGUAGE/FORCED/CHARACTERISTICS. Renditions
    // carry none of those attributes, so only the default may auto-select.
    `AUTOSELECT=${rendition.renditionId === group.defaultRenditionId ? "YES" : "NO"}`,
    ...channelsAttributes(rendition),
    `URI="${escapePlaylistValue(path)}"`,
  ];

  return `#EXT-X-MEDIA:${attributes.join(",")}`;
}

function channelsAttributes(rendition: AudioRendition): string[] {
  return rendition.channels === undefined
    ? []
    : [`CHANNELS="${rendition.channels}"`];
}

function renderVariantEntry(
  session: Session,
  rendition: VideoRendition,
  renditions: MasterPlaylistRenditions,
  mediaPlaylistPath: (session: Session, rendition: Rendition) => string
): string[] {
  const path = mediaPlaylistPath(session, rendition);
  assertSafeRelativePath(path, "media playlist path");

  return [
    `#EXT-X-STREAM-INF:${renderStreamAttributes(rendition, renditions)}`,
    path,
  ];
}

function renderStreamAttributes(
  rendition: VideoRendition,
  renditions: MasterPlaylistRenditions
): string {
  const bandwidth = requiredBandwidth(rendition);

  const attributes = [
    `BANDWIDTH=${bandwidth}`,
    `AVERAGE-BANDWIDTH=${bandwidth}`,
    codecsAttribute(rendition, renditions.variantAudioCodecs),
    ...resolutionAttributes(rendition),
    ...frameRateAttributes(rendition),
    ...audioGroupAttributes(renditions.audioGroup),
  ];

  return attributes.join(",");
}

function audioGroupAttributes(group: AudioGroup | undefined): string[] {
  return group === undefined
    ? []
    : [`AUDIO="${escapePlaylistValue(group.groupId)}"`];
}

function requiredBandwidth(rendition: VideoRendition): number {
  const bandwidth = rendition.bitrate;

  if (!bandwidth) {
    throw new Error(`rendition ${rendition.renditionId} must define bitrate`);
  }

  return bandwidth;
}

function codecsAttribute(
  rendition: VideoRendition,
  audioCodecs: readonly string[]
): string {
  return `CODECS="${escapePlaylistValue(
    [rendition.codec, ...audioCodecs].join(",")
  )}"`;
}

function frameRateAttributes(rendition: VideoRendition): string[] {
  return rendition.frameRate === undefined
    ? []
    : [`FRAME-RATE=${formatFrameRate(rendition.frameRate)}`];
}

function resolutionAttributes(rendition: VideoRendition): string[] {
  if (rendition.width === undefined && rendition.height === undefined) {
    return [];
  }

  if (hasPartialRenditionResolution(rendition)) {
    throw new Error(
      `rendition ${rendition.renditionId} must define width and height together`
    );
  }

  return [`RESOLUTION=${rendition.width}x${rendition.height}`];
}

function hasPartialRenditionResolution(rendition: VideoRendition): boolean {
  return rendition.width === undefined || rendition.height === undefined;
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isAudioRendition(rendition: Rendition): rendition is AudioRendition {
  return rendition.kind === "audio";
}

function isGroupedAudioRendition(
  rendition: AudioRendition
): rendition is GroupedAudioRendition {
  return rendition.groupId !== undefined;
}

function isVideoRendition(rendition: Rendition): rendition is VideoRendition {
  return rendition.kind === "video";
}

function defaultMediaPlaylistPath(
  session: Session,
  rendition: Rendition
): string {
  return `/v1/live/${session.sessionId}/${rendition.renditionId}/media.m3u8`;
}

function assertSessionShape(session: Session): void {
  if (!isUrlSafeIdentifier(session.sessionId)) {
    throw new Error(
      "session.sessionId must be a non-empty URL-safe identifier"
    );
  }

  if (!Array.isArray(session.renditions) || session.renditions.length === 0) {
    throw new Error("session.renditions must be a non-empty array");
  }

  for (const rendition of session.renditions) {
    assertRenditionShape(rendition);
  }
}

function assertRenditionShape(rendition: Rendition): void {
  if (!isUrlSafeIdentifier(rendition.renditionId)) {
    throw new Error(
      "rendition.renditionId must be a non-empty URL-safe identifier"
    );
  }

  if (typeof rendition.codec !== "string" || rendition.codec.length === 0) {
    throw new Error(`rendition ${rendition.renditionId} must define codec`);
  }

  if (
    rendition.groupId !== undefined &&
    !isUrlSafeIdentifier(rendition.groupId)
  ) {
    throw new Error(
      `rendition ${rendition.renditionId} groupId must be a non-empty URL-safe identifier`
    );
  }
}
