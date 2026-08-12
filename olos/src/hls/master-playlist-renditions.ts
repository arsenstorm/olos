import type { Rendition, Session } from "../types/session";
import { isUrlSafeIdentifier } from "../validation/ids";
import { formatFrameRate, quotedPlaylistValue } from "./format";
import type {
  AudioGroup,
  AudioRendition,
  GroupedAudioRendition,
  MasterPlaylistRenditions,
  VideoRendition,
} from "./master-playlist";
import { assertSafeRelativePath } from "./uri";
export function assertDistinctAudioRenditionNames(
  renditions: readonly GroupedAudioRendition[]
): void {
  const names = new Set<string>();

  for (const rendition of renditions) {
    const name = rendition.name ?? rendition.renditionId;

    if (names.has(name)) {
      throw new Error(
        "session.renditions must have distinct audio rendition names within a group"
      );
    }

    names.add(name);
  }
}

export function renderAudioGroupEntries(
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
    `GROUP-ID="${quotedPlaylistValue(group.groupId, "audio group id")}"`,
    `NAME="${quotedPlaylistValue(
      rendition.name ?? rendition.renditionId,
      `rendition ${rendition.renditionId} name`
    )}"`,
    `DEFAULT=${rendition.renditionId === group.defaultRenditionId ? "YES" : "NO"}`,
    // RFC 8216 §4.3.4.1.1: AUTOSELECT=YES members of a group must be
    // distinct on LANGUAGE/ASSOC-LANGUAGE/FORCED/CHARACTERISTICS. Renditions
    // carry none of those attributes, so only the default may auto-select.
    `AUTOSELECT=${rendition.renditionId === group.defaultRenditionId ? "YES" : "NO"}`,
    ...channelsAttributes(rendition),
    `URI="${quotedPlaylistValue(path, "media playlist path")}"`,
  ];

  return `#EXT-X-MEDIA:${attributes.join(",")}`;
}

function channelsAttributes(rendition: AudioRendition): string[] {
  return rendition.channels === undefined
    ? []
    : [`CHANNELS="${rendition.channels}"`];
}

export function renderVariantEntry(
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
    : [`AUDIO="${quotedPlaylistValue(group.groupId, "audio group id")}"`];
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
  return `CODECS="${quotedPlaylistValue(
    [rendition.codec, ...audioCodecs].join(","),
    `rendition ${rendition.renditionId} codecs`
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

export function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function isAudioRendition(
  rendition: Rendition
): rendition is AudioRendition {
  return rendition.kind === "audio";
}

export function isGroupedAudioRendition(
  rendition: AudioRendition
): rendition is GroupedAudioRendition {
  return rendition.groupId !== undefined;
}

export function isVideoRendition(
  rendition: Rendition
): rendition is VideoRendition {
  return rendition.kind === "video";
}

export function defaultMediaPlaylistPath(
  session: Session,
  rendition: Rendition
): string {
  return `/v1/live/${session.sessionId}/${rendition.renditionId}/media.m3u8`;
}

export function assertSessionShape(session: Session): void {
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
