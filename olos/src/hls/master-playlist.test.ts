import { describe, expect, test } from "bun:test";

import type { Session } from "../types/session";
import { renderMasterPlaylist } from "./master-playlist";

const session: Session = {
  createdAt: "2026-06-08T12:00:00Z",
  epoch: 1,
  latencyProfile: "object-ll",
  olos: "1.0",
  partTarget: 0.5,
  renditions: [
    {
      bitrate: 5_000_000,
      codec: "avc1.640028",
      frameRate: 30,
      height: 1080,
      kind: "video",
      renditionId: "v1080",
      width: 1920,
    },
    {
      bitrate: 2_800_000,
      codec: "avc1.4d401f",
      frameRate: 30,
      height: 720,
      kind: "video",
      renditionId: "v720",
      width: 1280,
    },
    {
      bitrate: 128_000,
      channels: 2,
      codec: "mp4a.40.2",
      kind: "audio",
      renditionId: "a128",
      sampleRate: 48_000,
    },
  ],
  segmentTarget: 2,
  sessionId: "sess_01JZLIVE",
  state: "live",
};

const groupedSession: Session = {
  ...session,
  renditions: [
    ...session.renditions.filter((rendition) => rendition.kind === "video"),
    {
      bitrate: 128_000,
      channels: 2,
      codec: "mp4a.40.2",
      defaultRendition: true,
      groupId: "aac",
      kind: "audio",
      name: "English",
      renditionId: "a128",
      sampleRate: 48_000,
    },
    {
      bitrate: 64_000,
      codec: "ec-3",
      groupId: "aac",
      kind: "audio",
      renditionId: "a64",
      sampleRate: 48_000,
    },
  ],
};

describe("master playlist rendering", () => {
  test("renders deterministic HLS master playlist", () => {
    expect(renderMasterPlaylist(session)).toBe(`#EXTM3U
#EXT-X-VERSION:10
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:BANDWIDTH=5000000,AVERAGE-BANDWIDTH=5000000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=30
/v1/live/sess_01JZLIVE/v1080/media.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,AVERAGE-BANDWIDTH=2800000,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=30
/v1/live/sess_01JZLIVE/v720/media.m3u8
`);
  });

  test("supports custom relative media playlist paths", () => {
    expect(
      renderMasterPlaylist(session, {
        mediaPlaylistPath: (_session, rendition) =>
          `/live/${rendition.renditionId}.m3u8`,
      })
    ).toContain("/live/v1080.m3u8");
  });

  test("builds media playlist paths only for video renditions", () => {
    const visitedRenditionIds: string[] = [];

    renderMasterPlaylist(session, {
      mediaPlaylistPath: (_session, rendition) => {
        visitedRenditionIds.push(rendition.renditionId);

        return `/live/${rendition.renditionId}.m3u8`;
      },
    });

    expect(visitedRenditionIds).toEqual(["v1080", "v720"]);
  });

  test("renders video-only stream codecs without audio codecs", () => {
    expect(
      renderMasterPlaylist({
        ...session,
        renditions: session.renditions.filter(
          (rendition) => rendition.kind === "video"
        ),
      })
    ).toContain('CODECS="avc1.640028"');
  });

  test("does not emit content steering", () => {
    expect(renderMasterPlaylist(session)).not.toContain(
      "#EXT-X-CONTENT-STEERING"
    );
  });

  test("rejects absolute media playlist paths", () => {
    expect(() =>
      renderMasterPlaylist(session, {
        mediaPlaylistPath: () => "https://example.com/media.m3u8",
      })
    ).toThrow("media playlist path must be a safe relative path");
  });

  test("rejects media playlist paths with query strings or fragments", () => {
    expect(() =>
      renderMasterPlaylist(session, {
        mediaPlaylistPath: () => "/live/v1080.m3u8?token=abc",
      })
    ).toThrow(
      "media playlist path must not contain query strings or fragments"
    );
  });

  test("rejects sessions without video renditions", () => {
    expect(() =>
      renderMasterPlaylist({
        ...session,
        renditions: session.renditions.filter(
          (rendition) => rendition.kind !== "video"
        ),
      })
    ).toThrow("session.renditions must include at least one video rendition");
  });

  test("rejects renditions without codecs", () => {
    const [videoRendition] = session.renditions;

    if (videoRendition === undefined) {
      throw new Error("expected video rendition fixture");
    }

    expect(() =>
      renderMasterPlaylist({
        ...session,
        renditions: [
          {
            ...videoRendition,
            codec: "",
          },
        ],
      })
    ).toThrow("rendition v1080 must define codec");
  });

  test("omits resolution attributes when video dimensions are absent", () => {
    const [videoRendition] = session.renditions;

    if (videoRendition === undefined) {
      throw new Error("expected video rendition fixture");
    }

    const {
      height: _height,
      width: _width,
      ...renditionWithoutDimensions
    } = videoRendition;

    expect(
      renderMasterPlaylist({
        ...session,
        renditions: [renditionWithoutDimensions],
      })
    ).not.toContain("RESOLUTION=");
  });

  test("renders EXT-X-MEDIA audio group entries with variant AUDIO wiring", () => {
    expect(renderMasterPlaylist(groupedSession)).toBe(`#EXTM3U
#EXT-X-VERSION:10
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="English",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="/v1/live/sess_01JZLIVE/a128/media.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="a64",DEFAULT=NO,AUTOSELECT=NO,URI="/v1/live/sess_01JZLIVE/a64/media.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,AVERAGE-BANDWIDTH=5000000,CODECS="avc1.640028,mp4a.40.2,ec-3",RESOLUTION=1920x1080,FRAME-RATE=30,AUDIO="aac"
/v1/live/sess_01JZLIVE/v1080/media.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,AVERAGE-BANDWIDTH=2800000,CODECS="avc1.4d401f,mp4a.40.2,ec-3",RESOLUTION=1280x720,FRAME-RATE=30,AUDIO="aac"
/v1/live/sess_01JZLIVE/v720/media.m3u8
`);
  });

  test("deduplicates grouped audio codecs in variant CODECS attributes", () => {
    const playlist = renderMasterPlaylist({
      ...groupedSession,
      renditions: groupedSession.renditions.map((rendition) =>
        rendition.kind === "audio"
          ? { ...rendition, codec: "mp4a.40.2" }
          : rendition
      ),
    });

    expect(playlist).toContain('CODECS="avc1.640028,mp4a.40.2"');
    expect(playlist).not.toContain("mp4a.40.2,mp4a.40.2");
  });

  test("defaults the first grouped audio rendition when none is flagged", () => {
    const playlist = renderMasterPlaylist({
      ...groupedSession,
      renditions: groupedSession.renditions.map((rendition) =>
        rendition.kind === "audio"
          ? { ...rendition, defaultRendition: undefined }
          : rendition
      ),
    });

    expect(playlist).toContain('NAME="English",DEFAULT=YES');
    expect(playlist).toContain('NAME="a64",DEFAULT=NO');
  });

  test("builds grouped audio media playlist URIs with the shared path hook", () => {
    const playlist = renderMasterPlaylist(groupedSession, {
      mediaPlaylistPath: (_session, rendition) =>
        `/live/${rendition.renditionId}.m3u8`,
    });

    expect(playlist).toContain('URI="/live/a128.m3u8"');
    expect(playlist).toContain('URI="/live/a64.m3u8"');
  });

  test("rejects unsafe grouped audio media playlist paths", () => {
    expect(() =>
      renderMasterPlaylist(groupedSession, {
        mediaPlaylistPath: (_session, rendition) =>
          rendition.kind === "audio"
            ? "https://example.com/audio.m3u8"
            : `/live/${rendition.renditionId}.m3u8`,
      })
    ).toThrow("media playlist path must be a safe relative path");
  });

  test("rejects mixed grouped and ungrouped audio renditions", () => {
    expect(() =>
      renderMasterPlaylist({
        ...groupedSession,
        renditions: [
          ...groupedSession.renditions,
          {
            codec: "mp4a.40.2",
            kind: "audio",
            renditionId: "a32",
          },
        ],
      })
    ).toThrow(
      "session.renditions must not mix grouped and ungrouped audio renditions"
    );
  });

  test("rejects multiple distinct audio groups", () => {
    expect(() =>
      renderMasterPlaylist({
        ...groupedSession,
        renditions: groupedSession.renditions.map((rendition) =>
          rendition.renditionId === "a64"
            ? { ...rendition, groupId: "aac-alt" }
            : rendition
        ),
      })
    ).toThrow("multiple audio groups are not supported");
  });

  test("rejects duplicate audio rendition names within a group", () => {
    expect(() =>
      renderMasterPlaylist({
        ...groupedSession,
        renditions: groupedSession.renditions.map((rendition) =>
          rendition.kind === "audio"
            ? { ...rendition, name: "English" }
            : rendition
        ),
      })
    ).toThrow(
      "session.renditions must have distinct audio rendition names within a group"
    );
  });

  test("rejects names colliding with another rendition's default name", () => {
    // a64 has no name, so its effective NAME is its rendition id — an
    // explicit NAME="a64" on a128 collides with it.
    expect(() =>
      renderMasterPlaylist({
        ...groupedSession,
        renditions: groupedSession.renditions.map((rendition) =>
          rendition.renditionId === "a128"
            ? { ...rendition, name: "a64" }
            : rendition
        ),
      })
    ).toThrow(
      "session.renditions must have distinct audio rendition names within a group"
    );
  });

  test("rejects audio rendition names quoted-strings cannot represent", () => {
    expect(() =>
      renderMasterPlaylist({
        ...groupedSession,
        renditions: groupedSession.renditions.map((rendition) =>
          rendition.renditionId === "a128"
            ? { ...rendition, name: 'English "TV"' }
            : rendition
        ),
      })
    ).toThrow("rendition a128 name must not contain double quotes");
  });

  test("rejects unsafe audio group identifiers", () => {
    expect(() =>
      renderMasterPlaylist({
        ...groupedSession,
        renditions: groupedSession.renditions.map((rendition) =>
          rendition.kind === "audio"
            ? { ...rendition, groupId: "not a group" }
            : rendition
        ),
      })
    ).toThrow("groupId must be a non-empty URL-safe identifier");
  });

  test("filters renditions absent from availableRenditionIds", () => {
    const playlist = renderMasterPlaylist(groupedSession, {
      availableRenditionIds: ["v1080", "v720", "a128"],
    });

    expect(playlist).toContain('NAME="English"');
    expect(playlist).not.toContain('NAME="a64"');
    expect(playlist).not.toContain("ec-3");
    expect(playlist).toContain('AUDIO="aac"');
  });

  test("omits the audio group when no grouped rendition is available", () => {
    const playlist = renderMasterPlaylist(groupedSession, {
      availableRenditionIds: ["v1080", "v720"],
    });

    expect(playlist).not.toContain("#EXT-X-MEDIA");
    expect(playlist).not.toContain("AUDIO=");
    expect(playlist).toContain('CODECS="avc1.640028"');
  });

  test("keeps the session-elected default when it is unavailable", () => {
    const playlist = renderMasterPlaylist(groupedSession, {
      availableRenditionIds: ["v1080", "a64"],
    });

    // The elected default (a128) has no committed media yet: it does not
    // render, and no other member is promoted in its place — every rendered
    // member carries DEFAULT=NO,AUTOSELECT=NO until a128 appears.
    expect(playlist).toContain('NAME="a64",DEFAULT=NO,AUTOSELECT=NO');
    expect(playlist).not.toContain('NAME="English"');
    expect(playlist).not.toContain("DEFAULT=YES");
  });

  test("filters video variants absent from availableRenditionIds", () => {
    const playlist = renderMasterPlaylist(session, {
      availableRenditionIds: ["v720", "a128"],
    });

    expect(playlist).toContain("/v1/live/sess_01JZLIVE/v720/media.m3u8");
    expect(playlist).not.toContain("v1080");
  });

  test("keeps ungrouped audio codecs when filtering", () => {
    const playlist = renderMasterPlaylist(session, {
      availableRenditionIds: ["v1080"],
    });

    expect(playlist).toContain('CODECS="avc1.640028,mp4a.40.2"');
  });

  test("rejects filters that remove every video rendition", () => {
    expect(() =>
      renderMasterPlaylist(groupedSession, {
        availableRenditionIds: ["a128"],
      })
    ).toThrow("no video rendition is available to render");
  });

  test("still validates grouping rules on filtered-out renditions", () => {
    expect(() =>
      renderMasterPlaylist(
        {
          ...groupedSession,
          renditions: [
            ...groupedSession.renditions,
            { codec: "mp4a.40.2", kind: "audio", renditionId: "a32" },
          ],
        },
        { availableRenditionIds: ["v1080", "a128"] }
      )
    ).toThrow(
      "session.renditions must not mix grouped and ungrouped audio renditions"
    );
  });

  test("rejects video renditions with partial resolution dimensions", () => {
    const [videoRendition] = session.renditions;

    if (videoRendition === undefined) {
      throw new Error("expected video rendition fixture");
    }

    expect(() =>
      renderMasterPlaylist({
        ...session,
        renditions: [
          {
            ...videoRendition,
            height: undefined,
          },
        ],
      })
    ).toThrow("rendition v1080 must define width and height together");
  });
});
