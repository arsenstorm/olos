import { describe, expect, test } from "bun:test";

import type { CommittedWindow } from "../types/committed-window";
import type { Cursor } from "../types/cursor";
import type { Session } from "../types/session";
import {
  createHlsManifestArtifactResponse,
  createHlsManifestArtifacts,
  createHlsManifestWebResponse,
  resolveBlockingHlsManifestArtifactResponse,
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

const cursor: Cursor = {
  committedWindow,
  epoch: 1,
  latencyProfile: "object-ll",
  olos: "1.0",
  partTarget: session.partTarget,
  pathways: [
    {
      baseUrl: "https://media.example.com",
      pathwayId: "primary",
      priority: 0,
      providerId: "s3_primary",
      state: "active",
    },
  ],
  segmentTarget: session.segmentTarget,
  sessionId: session.sessionId,
  state: "live",
  tenantId: session.tenantId,
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

  test("creates a web response from manifest response metadata", async () => {
    const [artifact] = createHlsManifestArtifacts(session, committedWindow, {
      allowedMediaOrigins: ["https://media.example.com"],
      partTarget: session.partTarget,
      segmentTarget: session.segmentTarget,
    });

    if (artifact === undefined) {
      throw new Error("expected manifest artifact");
    }

    const metadata = createHlsManifestArtifactResponse(artifact);
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

  test("resolves blocking manifest responses immediately when ready", async () => {
    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest: {
        allowedMediaOrigins: ["https://media.example.com"],
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

  test("waits before resolving a future media playlist request", async () => {
    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest: {
        allowedMediaOrigins: ["https://media.example.com"],
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
        allowedMediaOrigins: ["https://media.example.com"],
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
        allowedMediaOrigins: ["https://media.example.com"],
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
        allowedMediaOrigins: ["https://media.example.com"],
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

  test("returns not_found for unknown manifest paths", async () => {
    const result = await resolveBlockingHlsManifestArtifactResponse({
      cursor,
      manifest: {
        allowedMediaOrigins: ["https://media.example.com"],
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
});

function missingInit(): never {
  throw new Error("missing v1080 init fixture");
}
