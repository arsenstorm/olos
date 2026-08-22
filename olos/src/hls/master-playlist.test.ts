import { describe, expect, test } from "bun:test";

import type { MediaTrack, MediaTrackProfile } from "../media/types";
import type { Session } from "../types/session";
import { renderMasterPlaylist } from "./master-playlist";

const session: Session = {
  createdAt: "2026-06-08T12:00:00.000Z",
  epoch: 1,
  olos: "1.0",
  profile: { id: "cmaf-llhls", partTarget: 0.5, segmentTarget: 2 },
  sessionId: "sess_01JZLIVE",
  state: "live",
  tracks: [
    {
      profile: {
        bitrate: 5_000_000,
        codec: "avc1.640028",
        frameRate: 30,
        height: 1080,
        kind: "video",
        width: 1920,
      },
      trackId: "v1080",
    },
    {
      profile: {
        bitrate: 2_800_000,
        codec: "avc1.4d401f",
        frameRate: 30,
        height: 720,
        kind: "video",
        width: 1280,
      },
      trackId: "v720",
    },
    {
      profile: {
        bitrate: 128_000,
        channels: 2,
        codec: "mp4a.40.2",
        kind: "audio",
        sampleRate: 48_000,
      },
      trackId: "a128",
    },
  ],
};

const groupedSession: Session = {
  ...session,
  tracks: [
    ...session.tracks.filter((track) => trackKind(track) === "video"),
    {
      profile: {
        bitrate: 128_000,
        channels: 2,
        codec: "mp4a.40.2",
        defaultTrack: true,
        groupId: "aac",
        kind: "audio",
        name: "English",
        sampleRate: 48_000,
      },
      trackId: "a128",
    },
    {
      profile: {
        bitrate: 64_000,
        codec: "ec-3",
        groupId: "aac",
        kind: "audio",
        sampleRate: 48_000,
      },
      trackId: "a64",
    },
  ],
};

function trackKind(track: Session["tracks"][number]): string | undefined {
  return (track as MediaTrack).profile?.kind;
}

function withProfile(
  track: Session["tracks"][number],
  patch: Partial<MediaTrackProfile>
): Session["tracks"][number] {
  return { ...track, profile: { ...track.profile, ...patch } };
}

function videoTrack(): Session["tracks"][number] {
  const [track] = session.tracks;

  if (track === undefined) {
    throw new Error("expected video track fixture");
  }

  return track;
}

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
        mediaPlaylistPath: (_session, track) => `/live/${track.trackId}.m3u8`,
      })
    ).toContain("/live/v1080.m3u8");
  });

  test("builds media playlist paths only for video tracks", () => {
    const visitedTrackIds: string[] = [];

    renderMasterPlaylist(session, {
      mediaPlaylistPath: (_session, track) => {
        visitedTrackIds.push(track.trackId);

        return `/live/${track.trackId}.m3u8`;
      },
    });

    expect(visitedTrackIds).toEqual(["v1080", "v720"]);
  });

  test("renders video-only stream codecs without audio codecs", () => {
    expect(
      renderMasterPlaylist({
        ...session,
        tracks: session.tracks.filter((track) => trackKind(track) === "video"),
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

  test("rejects sessions without video tracks", () => {
    expect(() =>
      renderMasterPlaylist({
        ...session,
        tracks: session.tracks.filter((track) => trackKind(track) !== "video"),
      })
    ).toThrow("session.tracks must include at least one video track");
  });

  test("rejects sessions that do not run the media profile", () => {
    expect(() =>
      renderMasterPlaylist({ ...session, profile: { id: "custom" } })
    ).toThrow("session.profile.id must be cmaf-llhls");
  });

  test("rejects tracks without a media profile", () => {
    const { profile: _profile, ...bareTrack } = videoTrack();

    expect(() =>
      renderMasterPlaylist({ ...session, tracks: [bareTrack] })
    ).toThrow("session.tracks[v1080].profile is required");
  });

  test("rejects tracks without codecs", () => {
    expect(() =>
      renderMasterPlaylist({
        ...session,
        tracks: [withProfile(videoTrack(), { codec: "" })],
      })
    ).toThrow("session.tracks[v1080].profile.codec must be a non-empty string");
  });

  test("rejects video tracks without a bitrate", () => {
    expect(() =>
      renderMasterPlaylist({
        ...session,
        tracks: [withProfile(videoTrack(), { bitrate: undefined })],
      })
    ).toThrow("track v1080 must define bitrate");
  });

  test("omits resolution attributes when video dimensions are absent", () => {
    expect(
      renderMasterPlaylist({
        ...session,
        tracks: [
          withProfile(videoTrack(), { height: undefined, width: undefined }),
        ],
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
      tracks: groupedSession.tracks.map((track) =>
        trackKind(track) === "audio"
          ? withProfile(track, { codec: "mp4a.40.2" })
          : track
      ),
    });

    expect(playlist).toContain('CODECS="avc1.640028,mp4a.40.2"');
    expect(playlist).not.toContain("mp4a.40.2,mp4a.40.2");
  });

  test("defaults the first grouped audio track when none is flagged", () => {
    const playlist = renderMasterPlaylist({
      ...groupedSession,
      tracks: groupedSession.tracks.map((track) =>
        trackKind(track) === "audio"
          ? withProfile(track, { defaultTrack: undefined })
          : track
      ),
    });

    expect(playlist).toContain('NAME="English",DEFAULT=YES');
    expect(playlist).toContain('NAME="a64",DEFAULT=NO');
  });

  test("builds grouped audio media playlist URIs with the shared path hook", () => {
    const playlist = renderMasterPlaylist(groupedSession, {
      mediaPlaylistPath: (_session, track) => `/live/${track.trackId}.m3u8`,
    });

    expect(playlist).toContain('URI="/live/a128.m3u8"');
    expect(playlist).toContain('URI="/live/a64.m3u8"');
  });

  test("rejects unsafe grouped audio media playlist paths", () => {
    expect(() =>
      renderMasterPlaylist(groupedSession, {
        mediaPlaylistPath: (_session, track) =>
          trackKind(track) === "audio"
            ? "https://example.com/audio.m3u8"
            : `/live/${track.trackId}.m3u8`,
      })
    ).toThrow("media playlist path must be a safe relative path");
  });

  test("rejects mixed grouped and ungrouped audio tracks", () => {
    expect(() =>
      renderMasterPlaylist({
        ...groupedSession,
        tracks: [
          ...groupedSession.tracks,
          { profile: { codec: "mp4a.40.2", kind: "audio" }, trackId: "a32" },
        ],
      })
    ).toThrow("session.tracks must not mix grouped and ungrouped audio tracks");
  });

  test("rejects multiple distinct audio groups", () => {
    expect(() =>
      renderMasterPlaylist({
        ...groupedSession,
        tracks: groupedSession.tracks.map((track) =>
          track.trackId === "a64"
            ? withProfile(track, { groupId: "aac-alt" })
            : track
        ),
      })
    ).toThrow("multiple audio groups are not supported");
  });

  test("rejects duplicate audio track names within a group", () => {
    expect(() =>
      renderMasterPlaylist({
        ...groupedSession,
        tracks: groupedSession.tracks.map((track) =>
          trackKind(track) === "audio"
            ? withProfile(track, { name: "English" })
            : track
        ),
      })
    ).toThrow(
      "session.tracks must have distinct audio track names within a group"
    );
  });

  test("rejects names colliding with another track's default name", () => {
    // a64 has no name, so its effective NAME is its track id — an
    // explicit NAME="a64" on a128 collides with it.
    expect(() =>
      renderMasterPlaylist({
        ...groupedSession,
        tracks: groupedSession.tracks.map((track) =>
          track.trackId === "a128" ? withProfile(track, { name: "a64" }) : track
        ),
      })
    ).toThrow(
      "session.tracks must have distinct audio track names within a group"
    );
  });

  test("rejects audio track names quoted-strings cannot represent", () => {
    expect(() =>
      renderMasterPlaylist({
        ...groupedSession,
        tracks: groupedSession.tracks.map((track) =>
          track.trackId === "a128"
            ? withProfile(track, { name: 'English "TV"' })
            : track
        ),
      })
    ).toThrow(
      "session.tracks[a128].profile.name must not contain double quotes"
    );
  });

  test("rejects unsafe audio group identifiers", () => {
    expect(() =>
      renderMasterPlaylist({
        ...groupedSession,
        tracks: groupedSession.tracks.map((track) =>
          trackKind(track) === "audio"
            ? withProfile(track, { groupId: "not a group" })
            : track
        ),
      })
    ).toThrow(
      "session.tracks[a128].profile.groupId must be a non-empty URL-safe identifier"
    );
  });

  test("filters tracks absent from availableTrackIds", () => {
    const playlist = renderMasterPlaylist(groupedSession, {
      availableTrackIds: ["v1080", "v720", "a128"],
    });

    expect(playlist).toContain('NAME="English"');
    expect(playlist).not.toContain('NAME="a64"');
    expect(playlist).not.toContain("ec-3");
    expect(playlist).toContain('AUDIO="aac"');
  });

  test("omits the audio group when no grouped track is available", () => {
    const playlist = renderMasterPlaylist(groupedSession, {
      availableTrackIds: ["v1080", "v720"],
    });

    expect(playlist).not.toContain("#EXT-X-MEDIA");
    expect(playlist).not.toContain("AUDIO=");
    expect(playlist).toContain('CODECS="avc1.640028"');
  });

  test("keeps the session-elected default when it is unavailable", () => {
    const playlist = renderMasterPlaylist(groupedSession, {
      availableTrackIds: ["v1080", "a64"],
    });

    // The elected default (a128) has no committed media yet: it does not
    // render, and no other member is promoted in its place — every rendered
    // member carries DEFAULT=NO,AUTOSELECT=NO until a128 appears.
    expect(playlist).toContain('NAME="a64",DEFAULT=NO,AUTOSELECT=NO');
    expect(playlist).not.toContain('NAME="English"');
    expect(playlist).not.toContain("DEFAULT=YES");
  });

  test("filters video variants absent from availableTrackIds", () => {
    const playlist = renderMasterPlaylist(session, {
      availableTrackIds: ["v720", "a128"],
    });

    expect(playlist).toContain("/v1/live/sess_01JZLIVE/v720/media.m3u8");
    expect(playlist).not.toContain("v1080");
  });

  test("keeps ungrouped audio codecs when filtering", () => {
    const playlist = renderMasterPlaylist(session, {
      availableTrackIds: ["v1080"],
    });

    expect(playlist).toContain('CODECS="avc1.640028,mp4a.40.2"');
  });

  test("rejects filters that remove every video track", () => {
    expect(() =>
      renderMasterPlaylist(groupedSession, {
        availableTrackIds: ["a128"],
      })
    ).toThrow("no video track is available to render");
  });

  test("still validates grouping rules on filtered-out tracks", () => {
    expect(() =>
      renderMasterPlaylist(
        {
          ...groupedSession,
          tracks: [
            ...groupedSession.tracks,
            { profile: { codec: "mp4a.40.2", kind: "audio" }, trackId: "a32" },
          ],
        },
        { availableTrackIds: ["v1080", "a128"] }
      )
    ).toThrow("session.tracks must not mix grouped and ungrouped audio tracks");
  });

  test("rejects video tracks with partial resolution dimensions", () => {
    expect(() =>
      renderMasterPlaylist({
        ...session,
        tracks: [withProfile(videoTrack(), { height: undefined })],
      })
    ).toThrow(
      "session.tracks[v1080].profile must define width and height together"
    );
  });
});
