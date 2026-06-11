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
  tenantId: "tenant_acme",
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

  test("rejects absolute media playlist paths", () => {
    expect(() =>
      renderMasterPlaylist(session, {
        mediaPlaylistPath: () => "https://example.com/media.m3u8",
      })
    ).toThrow("media playlist path must be a safe relative path");
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
});
