import type { Rendition, Session } from "../types/session";
import {
  assertDistinctAudioRenditionNames,
  assertSessionShape,
  defaultMediaPlaylistPath,
  distinct,
  isAudioRendition,
  isGroupedAudioRendition,
  isVideoRendition,
  renderAudioGroupEntries,
  renderVariantEntry,
} from "./master-playlist-renditions";

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

export type AudioRendition = Rendition & { kind: "audio" };
export type GroupedAudioRendition = AudioRendition & { groupId: string };
export type VideoRendition = Rendition & { kind: "video" };

export interface AudioGroup {
  defaultRenditionId: string;
  groupId: string;
  renditions: readonly GroupedAudioRendition[];
}

export interface MasterPlaylistRenditions {
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

// Grouped audio renditions absent from the availability set are dropped
// from rendering, but the session-elected default keeps its seat: while the
// elected default has no committed media, every rendered member carries
// DEFAULT=NO,AUTOSELECT=NO (spec-legal and deterministic) instead of
// re-electing a temporary default that would flip back once the elected
// default commits. A group with no available member is not advertised at
// all. Ungrouped (muxed) audio renditions describe codecs inside the video
// segments, so they are never filtered.
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

  if (renditions.length === 0) {
    return;
  }

  return {
    defaultRenditionId: group.defaultRenditionId,
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

  assertDistinctAudioRenditionNames(grouped);

  const defaultRendition =
    grouped.find((rendition) => rendition.defaultRendition === true) ?? first;

  return {
    defaultRenditionId: defaultRendition.renditionId,
    groupId: first.groupId,
    renditions: grouped,
  };
}

// Render-time defense for sessions that skipped assertSession: duplicate
// effective NAMEs (name ?? renditionId) within a group are ambiguous to
// players (RFC 8216 §4.3.4.1.1). The full group is checked, so any
// availability-filtered subset of distinct names stays distinct.
