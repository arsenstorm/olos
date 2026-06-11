import type { Rendition, Session } from "../types/session";
import { isUrlSafeIdentifier } from "../validation/ids";

const PATH_CONTROL_CHARACTER_PATTERN = /[\r\n]/;

export interface RenderMasterPlaylistOptions {
  mediaPlaylistPath?: (session: Session, rendition: Rendition) => string;
}

export function renderMasterPlaylist(
  session: Session,
  options: RenderMasterPlaylistOptions = {}
): string {
  assertSessionShape(session);

  const audioCodecs = session.renditions
    .filter((rendition) => rendition.kind === "audio")
    .map((rendition) => rendition.codec);
  const videoRenditions = session.renditions.filter(
    (rendition) => rendition.kind === "video"
  );

  if (videoRenditions.length === 0) {
    throw new Error(
      "session.renditions must include at least one video rendition"
    );
  }

  const mediaPlaylistPath =
    options.mediaPlaylistPath ?? defaultMediaPlaylistPath;
  const lines = ["#EXTM3U", "#EXT-X-VERSION:10", "#EXT-X-INDEPENDENT-SEGMENTS"];

  for (const rendition of videoRenditions) {
    const path = mediaPlaylistPath(session, rendition);
    assertRelativePath(path);

    lines.push(
      `#EXT-X-STREAM-INF:${renderStreamAttributes(rendition, audioCodecs)}`,
      path
    );
  }

  return `${lines.join("\n")}\n`;
}

function renderStreamAttributes(
  rendition: Rendition,
  audioCodecs: string[]
): string {
  const bandwidth = rendition.bitrate;

  if (!bandwidth) {
    throw new Error(`rendition ${rendition.renditionId} must define bitrate`);
  }

  const attributes = [
    `BANDWIDTH=${bandwidth}`,
    `AVERAGE-BANDWIDTH=${bandwidth}`,
    `CODECS="${escapePlaylistValue(
      [rendition.codec, ...audioCodecs].join(",")
    )}"`,
  ];

  if (rendition.width !== undefined || rendition.height !== undefined) {
    if (!(rendition.width && rendition.height)) {
      throw new Error(
        `rendition ${rendition.renditionId} must define width and height together`
      );
    }

    attributes.push(`RESOLUTION=${rendition.width}x${rendition.height}`);
  }

  if (rendition.frameRate !== undefined) {
    attributes.push(`FRAME-RATE=${formatFrameRate(rendition.frameRate)}`);
  }

  return attributes.join(",");
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
    if (!isUrlSafeIdentifier(rendition.renditionId)) {
      throw new Error(
        "rendition.renditionId must be a non-empty URL-safe identifier"
      );
    }

    if (typeof rendition.codec !== "string" || rendition.codec.length === 0) {
      throw new Error(`rendition ${rendition.renditionId} must define codec`);
    }
  }
}

function assertRelativePath(value: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    PATH_CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new Error("media playlist path must be a safe relative path");
  }
}

function escapePlaylistValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function formatFrameRate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}
