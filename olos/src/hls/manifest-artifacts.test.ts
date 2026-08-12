import { describe, expect, test } from "bun:test";

import type { CommittedWindow } from "../types/committed-window";
import type { Cursor } from "../types/cursor";
import type { Session } from "../types/session";
import {
  type CreateHlsManifestArtifactsOptions,
  createCoordinatorManifestArtifacts,
  createHlsManifestArtifactResponse,
  createHlsManifestArtifacts,
  createHlsManifestErrorWebResponse,
  createHlsManifestWebResponse,
  type HlsManifestArtifact,
  resolveBlockingHlsManifestArtifactResponse,
  resolveHlsManifestArtifactResponse,
} from "./manifest-artifacts";

const MEDIA_ORIGIN = "https://media.example.com";

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
        deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
        objectKey: "media/v1080/init.mp4",
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

const cursor: Cursor = {
  committedWindow,
  epoch: 1,
  latencyProfile: "object-ll",
  mediaBaseUrl: "https://media.example.com",
  olos: "1.0",
  partTarget: session.partTarget,
  segmentTarget: session.segmentTarget,
  sessionId: session.sessionId,
  state: "live",
  updatedAt: "2026-01-01T00:00:02.000Z",
  window: {
    firstMediaSequenceNumber: 3810,
    lastMediaSequenceNumber: 3810,
  },
};

const advancedCommittedWindow: CommittedWindow = {
  ...committedWindow,
  lastMediaSequenceNumber: 3811,
  renditions: {
    v1080: {
      init: committedWindow.renditions.v1080?.init ?? missingInit(),
      renditionId: "v1080",
      segments: [
        ...(committedWindow.renditions.v1080?.segments ?? []),
        {
          duration: 2,
          mediaSequenceNumber: 3811,
          segment: {
            commitId: "commit_3811",
            deliveryUrl: "https://media.example.com/media/3811.m4s",
            objectKey: "media/3811.m4s",
            slotId: "slot_3811",
          },
        },
      ],
    },
  },
};

const advancedCursor: Cursor = {
  ...cursor,
  committedWindow: advancedCommittedWindow,
  updatedAt: "2026-01-01T00:00:04.000Z",
  window: {
    firstMediaSequenceNumber: 3810,
    lastMediaSequenceNumber: 3811,
  },
};

const groupedSession: Session = {
  ...session,
  renditions: session.renditions.map((rendition) =>
    rendition.kind === "audio"
      ? {
          ...rendition,
          defaultRendition: true,
          groupId: "aac",
          name: "English",
        }
      : rendition
  ),
};

const groupedCommittedWindow: CommittedWindow = {
  ...committedWindow,
  renditions: {
    ...committedWindow.renditions,
    a128: {
      init: {
        commitId: "commit_init_a128",
        deliveryUrl: "https://media.example.com/media/a128/init.mp4",
        objectKey: "media/a128/init.mp4",
        slotId: "slot_init_a128",
      },
      renditionId: "a128",
      segments: [
        {
          duration: 2,
          mediaSequenceNumber: 3810,
          segment: {
            commitId: "commit_a128_3810",
            deliveryUrl: "https://media.example.com/media/a128/3810.m4s",
            objectKey: "media/a128/3810.m4s",
            slotId: "slot_a128_3810",
          },
        },
      ],
    },
  },
};

function advancedVideoRenditionWindow() {
  const rendition = advancedCommittedWindow.renditions.v1080;

  if (!rendition) {
    throw new Error("missing advanced v1080 fixture");
  }

  return rendition;
}

function groupedAudioRenditionWindow() {
  const rendition = groupedCommittedWindow.renditions.a128;

  if (!rendition) {
    throw new Error("missing a128 rendition fixture");
  }

  return rendition;
}

const audioSegment3811 = {
  duration: 2,
  mediaSequenceNumber: 3811,
  segment: {
    commitId: "commit_a128_3811",
    deliveryUrl: "https://media.example.com/media/a128/3811.m4s",
    objectKey: "media/a128/3811.m4s",
    slotId: "slot_a128_3811",
  },
};

// v1080 has reached 3811 while the grouped audio rendition still ends at
// 3810 — the window-global live edge is ahead of a128's own live edge.
const laggedAudioCursor: Cursor = {
  ...cursor,
  committedWindow: {
    ...groupedCommittedWindow,
    lastMediaSequenceNumber: 3811,
    renditions: {
      a128: groupedAudioRenditionWindow(),
      v1080: advancedVideoRenditionWindow(),
    },
  },
  updatedAt: "2026-01-01T00:00:04.000Z",
  window: {
    firstMediaSequenceNumber: 3810,
    lastMediaSequenceNumber: 3811,
  },
};

const caughtUpGroupedCursor: Cursor = {
  ...laggedAudioCursor,
  committedWindow: {
    ...laggedAudioCursor.committedWindow,
    renditions: {
      a128: {
        ...groupedAudioRenditionWindow(),
        segments: [...groupedAudioRenditionWindow().segments, audioSegment3811],
      },
      v1080: advancedVideoRenditionWindow(),
    },
  },
  updatedAt: "2026-01-01T00:00:06.000Z",
};

// a128's window starts at 3811 while the window-global minimum is 3810 —
// its playlist must declare its own first segment's media sequence.
const audioTailCursor: Cursor = {
  ...laggedAudioCursor,
  committedWindow: {
    ...laggedAudioCursor.committedWindow,
    renditions: {
      a128: {
        ...groupedAudioRenditionWindow(),
        segments: [audioSegment3811],
      },
      v1080: advancedVideoRenditionWindow(),
    },
  },
};

describe("HLS manifest artifacts", () => {
  test("creates a master playlist artifact and media playlist artifacts", () => {
    const artifacts = createHlsManifestArtifacts(session, committedWindow, {
      allowedMediaOrigins: [MEDIA_ORIGIN],
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

  test("creates media playlist artifacts for grouped audio renditions", () => {
    const artifacts = createHlsManifestArtifacts(
      groupedSession,
      groupedCommittedWindow,
      {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      }
    );

    expect(artifacts.map((artifact) => artifact.path)).toEqual([
      "/v1/live/session_1/master.m3u8",
      "/v1/live/session_1/v1080/media.m3u8",
      "/v1/live/session_1/a128/media.m3u8",
    ]);

    const audioPlaylist = artifacts.at(-1);

    expect(audioPlaylist?.body).toContain("#EXT-X-MEDIA-SEQUENCE:3810");
    expect(audioPlaylist?.body).toContain(
      "https://media.example.com/media/a128/3810.m4s"
    );
    expect(artifacts[0]?.body).toContain(
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac"'
    );
  });

  test("excludes grouped audio renditions with no committed media", () => {
    // groupedSession declares a128 in the "aac" group, but the window only
    // has v1080 — the pre-fix behavior threw and 500ed every playlist.
    const artifacts = createHlsManifestArtifacts(
      groupedSession,
      committedWindow,
      {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      }
    );

    expect(artifacts.map((artifact) => artifact.path)).toEqual([
      "/v1/live/session_1/master.m3u8",
      "/v1/live/session_1/v1080/media.m3u8",
    ]);
    expect(artifacts[0]?.body).not.toContain("#EXT-X-MEDIA");
    expect(artifacts[0]?.body).not.toContain("AUDIO=");
  });

  test("excludes video renditions with no committed media", () => {
    const twoVideoSession: Session = {
      ...session,
      renditions: [
        ...session.renditions,
        {
          bitrate: 2_800_000,
          codec: "avc1.4d401f",
          frameRate: 30,
          height: 720,
          kind: "video",
          renditionId: "v720",
          width: 1280,
        },
      ],
    };

    const artifacts = createHlsManifestArtifacts(
      twoVideoSession,
      committedWindow,
      {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      }
    );

    expect(artifacts.map((artifact) => artifact.path)).toEqual([
      "/v1/live/session_1/master.m3u8",
      "/v1/live/session_1/v1080/media.m3u8",
    ]);
    expect(artifacts[0]?.body).not.toContain("v720");
  });

  test("omits the master artifact when no video rendition has committed media", () => {
    const audioOnlyWindow: CommittedWindow = {
      ...groupedCommittedWindow,
      renditions: {
        a128: groupedCommittedWindow.renditions.a128 ?? missingRendition(),
      },
    };

    const artifacts = createHlsManifestArtifacts(
      groupedSession,
      audioOnlyWindow,
      {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      }
    );

    expect(artifacts.map((artifact) => artifact.path)).toEqual([
      "/v1/live/session_1/a128/media.m3u8",
    ]);
  });

  test("does not create media playlist artifacts for ungrouped audio renditions", () => {
    const artifacts = createHlsManifestArtifacts(session, committedWindow, {
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: session.partTarget,
      segmentTarget: session.segmentTarget,
    });

    expect(artifacts.map((artifact) => artifact.path)).not.toContain(
      "/v1/live/session_1/a128/media.m3u8"
    );
  });

  test("ends every media playlist with EXT-X-ENDLIST for terminal sessions", () => {
    for (const state of ["ended", "aborted"] as const) {
      const [master, ...mediaPlaylists] = createHlsManifestArtifacts(
        { ...session, state },
        committedWindow,
        {
          allowedMediaOrigins: [MEDIA_ORIGIN],
          partTarget: session.partTarget,
          segmentTarget: session.segmentTarget,
        }
      );

      expect(master?.body).not.toContain("#EXT-X-ENDLIST");
      expect(mediaPlaylists.length).toBeGreaterThan(0);

      for (const artifact of mediaPlaylists) {
        expect(artifact.body.endsWith("\n#EXT-X-ENDLIST\n")).toBe(true);
      }
    }
  });

  test("derives coordinator end-of-stream from the cursor, not the session", () => {
    // A terminal cursor can precede (or lag) the session record's own
    // transition; coordinator rendering must follow the cursor's state.
    const { artifacts } = createCoordinatorManifestArtifacts({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: session.partTarget,
      segmentTarget: session.segmentTarget,
      state: {
        cursor: { ...cursor, state: "ended" },
        session,
      },
    });
    const mediaPlaylists = artifacts.filter((artifact) =>
      artifact.path.endsWith("/media.m3u8")
    );

    expect(session.state).toBe("live");
    expect(mediaPlaylists.length).toBeGreaterThan(0);

    for (const artifact of mediaPlaylists) {
      expect(artifact.body.endsWith("\n#EXT-X-ENDLIST\n")).toBe(true);
    }
  });

  test("omits EXT-X-ENDLIST for live sessions", () => {
    const artifacts = createHlsManifestArtifacts(session, committedWindow, {
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: session.partTarget,
      segmentTarget: session.segmentTarget,
    });

    for (const artifact of artifacts) {
      expect(artifact.body).not.toContain("#EXT-X-ENDLIST");
    }
  });

  test("supports custom safe playlist paths", () => {
    const visitedRenditionIds: string[] = [];
    const artifacts = createHlsManifestArtifacts(session, committedWindow, {
      allowedMediaOrigins: [MEDIA_ORIGIN],
      masterPath: "/live/session_1/index.m3u8",
      mediaPlaylistPath: (_session, rendition) => {
        visitedRenditionIds.push(rendition.renditionId);

        return `/live/session_1/${rendition.renditionId}.m3u8`;
      },
      partTarget: session.partTarget,
      segmentTarget: session.segmentTarget,
    });

    expect(artifacts.map((artifact) => artifact.path)).toEqual([
      "/live/session_1/index.m3u8",
      "/live/session_1/v1080.m3u8",
    ]);
    expect(visitedRenditionIds).toEqual(["v1080", "v1080"]);
    expect(artifacts[0]?.body).toContain("/live/session_1/v1080.m3u8");
  });

  test("rejects unsafe artifact paths", () => {
    expect(() =>
      createHlsManifestArtifacts(session, committedWindow, {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        masterPath: "master.m3u8",
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      })
    ).toThrow("master playlist path must be a safe relative path");
  });

  test("creates HTTP response metadata for manifest artifacts", () => {
    const [artifact] = createHlsManifestArtifacts(session, committedWindow, {
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: session.partTarget,
      segmentTarget: session.segmentTarget,
    });

    const manifestArtifact = requiredManifestArtifact(artifact);

    expect(createHlsManifestArtifactResponse(manifestArtifact)).toEqual({
      body: manifestArtifact.body,
      headers: {
        "cache-control": "public, max-age=1, must-revalidate",
        "content-type": "application/vnd.apple.mpegurl",
      },
      status: 200,
    });
  });

  test("creates a web response from manifest response metadata", async () => {
    const [artifact] = createHlsManifestArtifacts(session, committedWindow, {
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: session.partTarget,
      segmentTarget: session.segmentTarget,
    });

    const manifestArtifact = requiredManifestArtifact(artifact);

    const metadata = createHlsManifestArtifactResponse(manifestArtifact);
    const response = createHlsManifestWebResponse(metadata);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=1, must-revalidate"
    );
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.apple.mpegurl"
    );
    expect(await response.text()).toBe(metadata.body);
  });

  test("creates web responses for manifest gateway errors", async () => {
    const invalid = createHlsManifestErrorWebResponse({
      message: "_HLS_msn must be a non-negative integer",
      status: "invalid",
    });
    const notFound = createHlsManifestErrorWebResponse({
      status: "not_found",
    });

    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8"
    );
    expect(await invalid.text()).toBe(
      "_HLS_msn must be a non-negative integer"
    );
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8"
    );
    expect(await notFound.text()).toBe("manifest not found");
  });

  test("keeps manifest response freshness within target latency", () => {
    const [artifact] = createHlsManifestArtifacts(session, committedWindow, {
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: session.partTarget,
      segmentTarget: session.segmentTarget,
    });

    const manifestArtifact = requiredManifestArtifact(artifact);

    expect(() =>
      createHlsManifestArtifactResponse(manifestArtifact, {
        maxAgeSeconds: 5,
        targetLatencySeconds: 3,
      })
    ).toThrow(
      "maxAgeSeconds must be less than or equal to targetLatencySeconds"
    );
  });

  test("resolves manifest responses by request path", () => {
    const artifacts = createHlsManifestArtifacts(session, committedWindow, {
      allowedMediaOrigins: [MEDIA_ORIGIN],
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
        "http://edge.example.com/v1/live/session_1/master.m3u8"
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
    expect(
      resolveHlsManifestArtifactResponse(
        artifacts,
        "ftp://edge.example.com/v1/live/session_1/master.m3u8"
      )
    ).toBeUndefined();
  });

  test("resolves blocking manifest responses immediately when ready", async () => {
    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest: {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      requestUrl: "/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3810",
      session,
      timeoutMs: 100,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(result.status).toBe("ready");

    if (result.status === "ready" || result.status === "timeout") {
      expect(result.response.body).toContain("#EXT-X-MEDIA-SEQUENCE:3810");
      expect(result.response.body).toContain(
        "https://media.example.com/media/3810.m4s"
      );
    }
  });

  test("resolves blocking manifest responses from absolute HTTPS URLs", async () => {
    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest: {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      requestUrl:
        "https://edge.example.com/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3810",
      session,
      timeoutMs: 100,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(result.status).toBe("ready");

    if (result.status === "ready" || result.status === "timeout") {
      expect(result.response.body).toContain("#EXT-X-MEDIA-SEQUENCE:3810");
    }
  });

  test("ends blocking media playlists when the cursor reports a terminal state", async () => {
    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor: { ...cursor, state: "ended" },
      manifest: {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      requestUrl: "/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3810",
      session,
      timeoutMs: 100,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(result.status).toBe("ready");

    if (result.status === "ready" || result.status === "timeout") {
      expect(result.response.body.endsWith("\n#EXT-X-ENDLIST\n")).toBe(true);
    }
  });

  test("waits before resolving a future media playlist request", async () => {
    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest: {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      requestUrl: "/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3811",
      session,
      timeoutMs: 100,
      waitForCursor: () => Promise.resolve(advancedCursor),
    });

    expect(result.status).toBe("ready");

    if (result.status === "ready" || result.status === "timeout") {
      expect(result.cursor).toBe(advancedCursor);
      expect(result.response.body).toContain(
        "https://media.example.com/media/3811.m4s"
      );
    }
  });

  test("returns the current playlist on blocking timeout", async () => {
    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest: {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      requestUrl: "/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3811",
      session,
      timeoutMs: 0,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(result.status).toBe("timeout");

    if (result.status === "ready" || result.status === "timeout") {
      expect(result.cursor).toBe(cursor);
      expect(result.response.body).toContain(
        "https://media.example.com/media/3810.m4s"
      );
    }
  });

  test("returns invalid blocking manifest requests", async () => {
    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest: {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      requestUrl: "/v1/live/session_1/v1080/media.m3u8?_HLS_part=0",
      session,
      timeoutMs: 100,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(result).toEqual({
      message: "_HLS_part requires _HLS_msn",
      status: "invalid",
    });
  });

  test("returns invalid malformed blocking query params", async () => {
    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest: {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      requestUrl: "/v1/live/session_1/v1080/media.m3u8?_HLS_msn=-1",
      session,
      timeoutMs: 100,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(result).toEqual({
      message: "_HLS_msn must be a non-negative integer",
      status: "invalid",
    });
  });

  test("holds lagging grouped-audio reloads until the rendition catches up", async () => {
    let waiterCalls = 0;

    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor: laggedAudioCursor,
      manifest: {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      // 3811 is already committed window-globally (v1080), but a128's own
      // live edge is 3810 — the request must block on a128's playlist.
      requestUrl: "/v1/live/session_1/a128/media.m3u8?_HLS_msn=3811",
      session: groupedSession,
      timeoutMs: 100,
      waitForCursor: () => {
        waiterCalls += 1;
        return Promise.resolve(caughtUpGroupedCursor);
      },
    });

    expect(waiterCalls).toBe(1);
    expect(result.status).toBe("ready");

    if (result.status === "ready" || result.status === "timeout") {
      expect(result.cursor).toBe(caughtUpGroupedCursor);
      expect(result.response.body).toContain(
        "https://media.example.com/media/a128/3811.m4s"
      );
      expect(result.response.body).not.toContain("#EXT-X-STREAM-INF");
    }
  });

  test("returns the rendition's own playlist on per-rendition timeout", async () => {
    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor: audioTailCursor,
      manifest: {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      requestUrl: "/v1/live/session_1/a128/media.m3u8?_HLS_msn=3812",
      session: groupedSession,
      timeoutMs: 0,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(result.status).toBe("timeout");

    if (result.status === "ready" || result.status === "timeout") {
      // Per-rendition media sequence: a128's own first segment (3811), not
      // the window-global minimum (3810).
      expect(result.response.body).toContain("#EXT-X-MEDIA-SEQUENCE:3811");
      expect(result.response.body).toContain(
        "https://media.example.com/media/a128/3811.m4s"
      );
    }
  });

  test("rejects delivery directives on the master playlist path", async () => {
    let waiterCalls = 0;

    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest: {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      requestUrl: "/v1/live/session_1/master.m3u8?_HLS_msn=3810",
      session,
      timeoutMs: 100,
      waitForCursor: () => {
        waiterCalls += 1;
        return Promise.reject(new Error("waiter should not be called"));
      },
    });

    expect(result).toEqual({
      message: "_HLS_msn/_HLS_part apply to media playlist requests",
      status: "invalid",
    });
    expect(waiterCalls).toBe(0);
  });

  test("answers unknown paths immediately without consuming the timeout", async () => {
    let waiterCalls = 0;

    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest: {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      requestUrl: "/v1/live/session_1/missing.m3u8?_HLS_msn=9999",
      session,
      // A held request would hang the test well past its own timeout — the
      // immediate resolution proves no waiter was pinned.
      timeoutMs: 3_600_000,
      waitForCursor: () => {
        waiterCalls += 1;
        return Promise.reject(new Error("waiter should not be called"));
      },
    });

    expect(result).toEqual({ status: "not_found" });
    expect(waiterCalls).toBe(0);
  });

  test("rejects _HLS_msn more than two beyond the rendition's live edge", async () => {
    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest: {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      requestUrl: "/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3813",
      session,
      timeoutMs: 100,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(result).toEqual({
      message: "_HLS_msn is beyond the live edge",
      status: "invalid",
    });
  });

  test("still blocks _HLS_msn exactly two beyond the rendition's live edge", async () => {
    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest: {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      requestUrl: "/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3812",
      session,
      timeoutMs: 0,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(result.status).toBe("timeout");
  });

  test("answers media paths for uncommitted renditions with not_found", async () => {
    let waiterCalls = 0;

    const result = await resolveBlockingHlsManifestArtifactResponse({
      // The window only has v1080 — a128 is declared but uncommitted.
      cursor,
      manifest: {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      requestUrl: "/v1/live/session_1/a128/media.m3u8?_HLS_msn=3810",
      session: groupedSession,
      timeoutMs: 100,
      waitForCursor: () => {
        waiterCalls += 1;
        return Promise.reject(new Error("waiter should not be called"));
      },
    });

    expect(result).toEqual({ status: "not_found" });
    expect(waiterCalls).toBe(0);
  });

  test("serves the final ENDLIST playlist when a terminal cursor arrives mid-wait", async () => {
    const endedCursor: Cursor = { ...cursor, state: "ended" };

    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest: {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      requestUrl: "/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3811",
      session,
      timeoutMs: 10_000,
      waitForCursor: () => Promise.resolve(endedCursor),
    });

    expect(result.status).toBe("timeout");

    if (result.status === "ready" || result.status === "timeout") {
      expect(result.cursor).toBe(endedCursor);
      expect(result.response.status).toBe(200);
      expect(result.response.body.endsWith("\n#EXT-X-ENDLIST\n")).toBe(true);
    }
  });

  test("routes blocking requests through custom playlist paths", async () => {
    const manifest: CreateHlsManifestArtifactsOptions = {
      allowedMediaOrigins: [MEDIA_ORIGIN],
      masterPath: "/live/session_1/index.m3u8",
      mediaPlaylistPath: (_session, rendition) =>
        `/live/session_1/${rendition.renditionId}.m3u8`,
      partTarget: session.partTarget,
      segmentTarget: session.segmentTarget,
    };
    const waitForCursor = () =>
      Promise.reject(new Error("waiter should not be called"));

    const media = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest,
      requestUrl: "/live/session_1/v1080.m3u8?_HLS_msn=3810",
      session,
      timeoutMs: 100,
      waitForCursor,
    });

    expect(media.status).toBe("ready");

    if (media.status === "ready" || media.status === "timeout") {
      expect(media.response.body).toContain(
        "https://media.example.com/media/3810.m4s"
      );
    }

    const master = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest,
      requestUrl: "/live/session_1/index.m3u8",
      session,
      timeoutMs: 100,
      waitForCursor,
    });

    expect(master.status).toBe("ready");

    if (master.status === "ready" || master.status === "timeout") {
      expect(master.response.body).toContain("/live/session_1/v1080.m3u8");
    }

    // The default paths are not routable once custom paths are configured —
    // routing and rendering resolve paths identically.
    const defaultPath = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest,
      requestUrl: "/v1/live/session_1/v1080/media.m3u8",
      session,
      timeoutMs: 100,
      waitForCursor,
    });

    expect(defaultPath).toEqual({ status: "not_found" });
  });

  test("returns not_found for unknown manifest paths", async () => {
    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest: {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      requestUrl: "/v1/live/session_1/missing.m3u8",
      session,
      timeoutMs: 100,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(result).toEqual({ status: "not_found" });
  });

  test("returns not_found for unknown absolute manifest URLs", async () => {
    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest: {
        allowedMediaOrigins: [MEDIA_ORIGIN],
        partTarget: session.partTarget,
        segmentTarget: session.segmentTarget,
      },
      requestUrl: "https://edge.example.com/v1/live/session_1/missing.m3u8",
      session,
      timeoutMs: 100,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(result).toEqual({ status: "not_found" });
  });
});

function requiredManifestArtifact(
  artifact: HlsManifestArtifact | undefined
): HlsManifestArtifact {
  if (artifact === undefined) {
    throw new Error("expected manifest artifact");
  }

  return artifact;
}

function missingInit(): never {
  throw new Error("missing v1080 init fixture");
}

function missingRendition(): never {
  throw new Error("missing a128 rendition fixture");
}
