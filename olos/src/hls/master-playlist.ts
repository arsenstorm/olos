import type { Rendition, Session } from "../types/session";
import { isUrlSafeIdentifier } from "../validation/ids";
import { escapePlaylistValue, formatFrameRate } from "./format";
import { assertSafeRelativePath } from "./uri";

export interface RenderMasterPlaylistOptions {
  mediaPlaylistPath?: (session: Session, rendition: Rendition) => string;
}

type AudioRendition = Rendition & { kind: "audio" };
type VideoRendition = Rendition & { kind: "video" };

interface MasterPlaylistRenditions {
  audioCodecs: readonly string[];
  videoRenditions: readonly VideoRendition[];
}

export function renderMasterPlaylist(
  session: Session,
  options: RenderMasterPlaylistOptions = {}
): string {
  assertSessionShape(session);

  const renditions = masterPlaylistRenditions(session);
  const mediaPlaylistPath =
    options.mediaPlaylistPath ?? defaultMediaPlaylistPath;
  const lines = ["#EXTM3U", "#EXT-X-VERSION:10", "#EXT-X-INDEPENDENT-SEGMENTS"];

  for (const rendition of renditions.videoRenditions) {
    lines.push(
      ...renderVariantEntry(
        session,
        rendition,
        renditions.audioCodecs,
        mediaPlaylistPath
      )
    );
  }

  return `${lines.join("\n")}\n`;
}

function masterPlaylistRenditions(session: Session): MasterPlaylistRenditions {
  const audioCodecs = session.renditions
    .filter(isAudioRendition)
    .map((rendition) => rendition.codec);
  const videoRenditions = session.renditions.filter(isVideoRendition);

  if (videoRenditions.length === 0) {
    throw new Error(
      "session.renditions must include at least one video rendition"
    );
  }

  return { audioCodecs, videoRenditions };
}

function renderVariantEntry(
  session: Session,
  rendition: VideoRendition,
  audioCodecs: readonly string[],
  mediaPlaylistPath: (session: Session, rendition: Rendition) => string
): string[] {
  const path = mediaPlaylistPath(session, rendition);
  assertSafeRelativePath(path, "media playlist path");

  return [
    `#EXT-X-STREAM-INF:${renderStreamAttributes(rendition, audioCodecs)}`,
    path,
  ];
}

function renderStreamAttributes(
  rendition: VideoRendition,
  audioCodecs: readonly string[]
): string {
  const bandwidth = requiredBandwidth(rendition);

  const attributes = [
    `BANDWIDTH=${bandwidth}`,
    `AVERAGE-BANDWIDTH=${bandwidth}`,
    codecsAttribute(rendition, audioCodecs),
    ...resolutionAttributes(rendition),
    ...frameRateAttributes(rendition),
  ];

  return attributes.join(",");
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

function isAudioRendition(rendition: Rendition): rendition is AudioRendition {
  return rendition.kind === "audio";
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
}
