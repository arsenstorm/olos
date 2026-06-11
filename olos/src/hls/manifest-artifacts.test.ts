import { describe, expect, test } from "bun:test";

import type { CommittedWindow } from "../types/committed-window";
import type { Session } from "../types/session";
import {
  createHlsManifestArtifactResponse,
  createHlsManifestArtifacts,
  resolveHlsManifestArtifactResponse,
} from "./manifest-artifacts";

const session: Session = {
  createdAt: "2026-01-01T00:00:00.000Z",
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
      bitrate: 128_000,
      channels: 2,
      codec: "mp4a.40.2",
      kind: "audio",
      renditionId: "a128",
      sampleRate: 48_000,
    },
  ],
  segmentTarget: 2,
  sessionId: "session_1",
  state: "live",
  tenantId: "tenant_1",
};

const committedWindow: CommittedWindow = {
  discontinuitySequence: 0,
  epoch: 1,
  firstMediaSequenceNumber: 3810,
  lastMediaSequenceNumber: 3810,
  renditions: {
    v1080: {
      init: {
        commitId: "commit_init",
        deliveryUrl: "https://media.example.com/media/init.mp4",
        objectKey: "media/init.mp4",
        slotId: "slot_init",
      },
      renditionId: "v1080",
      segments: [
        {
          duration: 2,
          mediaSequenceNumber: 3810,
          segment: {
            commitId: "commit_3810",
            deliveryUrl: "https://media.example.com/media/3810.m4s",
            objectKey: "media/3810.m4s",
            slotId: "slot_3810",
          },
        },
      ],
    },
  },
};

describe("HLS manifest artifacts", () => {
  test("creates a master playlist artifact and media playlist artifacts", () => {
    const artifacts = createHlsManifestArtifacts(session, committedWindow, {
      allowedMediaOrigins: ["https://media.example.com"],
      partTarget: session.partTarget,
      segmentTarget: session.segmentTarget,
    });

    expect(
      artifacts.map((artifact) => ({
        contentType: artifact.contentType,
        path: artifact.path,
      }))
    ).toEqual([
      {
        contentType: "application/vnd.apple.mpegurl",
        path: "/v1/live/session_1/master.m3u8",
      },
      {
        contentType: "application/vnd.apple.mpegurl",
        path: "/v1/live/session_1/v1080/media.m3u8",
      },
    ]);
    expect(artifacts[0]?.body).toContain("/v1/live/session_1/v1080/media.m3u8");
    expect(artifacts[1]?.body).toContain("#EXT-X-MEDIA-SEQUENCE:3810");
    expect(artifacts[1]?.body).toContain(
      "https://media.example.com/media/3810.m4s"
    );
  });

  test("supports custom safe playlist paths", () => {
    const artifacts = createHlsManifestArtifacts(session, committedWindow, {
      allowedMediaOrigins: ["https://media.example.com"],
      masterPath: "/live/session_1/index.m3u8",
      mediaPlaylistPath: (_session, rendition) =>
        `/live/session_1/${rendition.renditionId}.m3u8`,
      partTarget: session.partTarget,
      segmentTarget: session.segmentTarget,
    });

    expect(artifacts.map((artifact) => artifact.path)).toEqual([
      "/live/session_1/index.m3u8",
      "/live/session_1/v1080.m3u8",
    ]);
    expect(artifacts[0]?.body).toContain("/live/session_1/v1080.m3u8");
  });

  test("rejects unsafe artifact paths", () => {
    expect(() =>
      createHlsManifestArtifacts(session, committedWindow, {
        allowedMediaOrigins: ["https://media.example.com"],
        masterPath: "master.m3u8",
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      })
    ).toThrow("master playlist path must be a safe relative path");
  });

  test("creates HTTP response metadata for manifest artifacts", () => {
    const [artifact] = createHlsManifestArtifacts(session, committedWindow, {
      allowedMediaOrigins: ["https://media.example.com"],
      partTarget: session.partTarget,
      segmentTarget: session.segmentTarget,
    });

    if (artifact === undefined) {
      throw new Error("expected manifest artifact");
    }

    expect(createHlsManifestArtifactResponse(artifact)).toEqual({
      body: artifact.body,
      headers: {
        "cache-control": "public, max-age=1, must-revalidate",
        "content-type": "application/vnd.apple.mpegurl",
      },
      status: 200,
    });
  });

  test("keeps manifest response freshness within target latency", () => {
    const [artifact] = createHlsManifestArtifacts(session, committedWindow, {
      allowedMediaOrigins: ["https://media.example.com"],
      partTarget: session.partTarget,
      segmentTarget: session.segmentTarget,
    });

    if (artifact === undefined) {
      throw new Error("expected manifest artifact");
    }

    expect(() =>
      createHlsManifestArtifactResponse(artifact, {
        maxAgeSeconds: 5,
        targetLatencySeconds: 3,
      })
    ).toThrow(
      "maxAgeSeconds must be less than or equal to targetLatencySeconds"
    );
  });

  test("resolves manifest responses by request path", () => {
    const artifacts = createHlsManifestArtifacts(session, committedWindow, {
      allowedMediaOrigins: ["https://media.example.com"],
      partTarget: session.partTarget,
      segmentTarget: session.segmentTarget,
    }).map((artifact) => ({
      ...artifact,
      response: createHlsManifestArtifactResponse(artifact),
    }));

    const response = resolveHlsManifestArtifactResponse(
      artifacts,
      "/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3810"
    );

    expect(response?.body).toContain("#EXT-X-MEDIA-SEQUENCE:3810");
    expect(
      resolveHlsManifestArtifactResponse(
        artifacts,
        "https://edge.example.com/v1/live/session_1/master.m3u8"
      )?.body
    ).toContain("/v1/live/session_1/v1080/media.m3u8");
    expect(
      resolveHlsManifestArtifactResponse(
        artifacts,
        "/v1/live/session_1/missing.m3u8"
      )
    ).toBeUndefined();
    expect(
      resolveHlsManifestArtifactResponse(artifacts, "media.m3u8")
    ).toBeUndefined();
  });
});
