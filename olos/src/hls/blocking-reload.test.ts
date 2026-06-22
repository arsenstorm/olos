import { describe, expect, test } from "bun:test";

import type { Cursor } from "../types/cursor";
import {
  parseHlsBlockingReloadRequest,
  resolveHlsBlockingReload,
  waitForHlsBlockingReload,
} from "./blocking-reload";

const cursor: Cursor = {
  committedWindow: {
    discontinuitySequence: 0,
    epoch: 1,
    firstMediaSequenceNumber: 3810,
    lastMediaSequenceNumber: 3812,
    renditions: {
      v1080: {
        init: {
          commitId: "commit_init",
          deliveryUrl: "/media/init.mp4",
          objectKey: "media/init.mp4",
          slotId: "slot_init",
        },
        renditionId: "v1080",
        segments: [
          {
            duration: 2,
            mediaSequenceNumber: 3812,
            parts: [
              {
                commitId: "commit_3812_0",
                deliveryUrl: "/media/3812.0.m4s",
                duration: 0.5,
                objectKey: "media/3812.0.m4s",
                partNumber: 0,
                slotId: "slot_3812_0",
              },
              {
                commitId: "commit_3812_1",
                deliveryUrl: "/media/3812.1.m4s",
                duration: 0.5,
                objectKey: "media/3812.1.m4s",
                partNumber: 1,
                slotId: "slot_3812_1",
              },
            ],
          },
        ],
      },
    },
  },
  epoch: 1,
  latencyProfile: "object-ll",
  olos: "1.0",
  partTarget: 0.5,
  pathways: [
    {
      baseUrl: "https://media.example.com",
      pathwayId: "primary",
      priority: 0,
      providerId: "s3_primary",
      state: "active",
    },
  ],
  segmentTarget: 2,
  sessionId: "session_1",
  state: "live",
  tenantId: "tenant_1",
  updatedAt: "2026-01-01T00:00:02.000Z",
  window: {
    firstMediaSequenceNumber: 3810,
    lastMediaSequenceNumber: 3812,
    lastPartNumber: 1,
  },
};

function validRendition() {
  const rendition = cursor.committedWindow.renditions.v1080;

  if (!rendition) {
    throw new Error("missing v1080 test fixture");
  }

  return rendition;
}

const advancedCursor: Cursor = {
  ...cursor,
  committedWindow: {
    ...cursor.committedWindow,
    lastMediaSequenceNumber: 3813,
    renditions: {
      v1080: {
        ...validRendition(),
        segments: [
          ...validRendition().segments,
          {
            duration: 0.5,
            mediaSequenceNumber: 3813,
            parts: [
              {
                commitId: "commit_3813_0",
                deliveryUrl: "/media/3813.0.m4s",
                duration: 0.5,
                objectKey: "media/3813.0.m4s",
                partNumber: 0,
                slotId: "slot_3813_0",
              },
            ],
          },
        ],
      },
    },
  },
  updatedAt: "2026-01-01T00:00:02.500Z",
  window: {
    ...cursor.window,
    lastMediaSequenceNumber: 3813,
    lastPartNumber: 0,
  },
};

describe("HLS blocking reload", () => {
  test("parses blocking reload query params", () => {
    expect(
      parseHlsBlockingReloadRequest(
        "/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3812&_HLS_part=1"
      )
    ).toEqual({
      mediaSequenceNumber: 3812,
      partNumber: 1,
    });
  });

  test("returns ready when no blocking position is requested", () => {
    expect(resolveHlsBlockingReload(cursor, {})).toEqual({
      request: {},
      status: "ready",
    });
  });

  test("returns ready for positions already covered by the cursor", () => {
    expect(
      resolveHlsBlockingReload(cursor, {
        mediaSequenceNumber: 3812,
        partNumber: 1,
      })
    ).toEqual({
      request: {
        mediaSequenceNumber: 3812,
        partNumber: 1,
      },
      status: "ready",
    });
  });

  test("blocks when the request is beyond the live cursor", () => {
    expect(
      resolveHlsBlockingReload(cursor, {
        mediaSequenceNumber: 3812,
        partNumber: 2,
      })
    ).toEqual({
      request: {
        mediaSequenceNumber: 3812,
        partNumber: 2,
      },
      status: "block",
    });

    expect(
      resolveHlsBlockingReload(cursor, {
        mediaSequenceNumber: 3813,
      })
    ).toEqual({
      request: {
        mediaSequenceNumber: 3813,
      },
      status: "block",
    });
  });

  test("rejects part-only blocking requests", () => {
    expect(resolveHlsBlockingReload(cursor, { partNumber: 0 })).toEqual({
      message: "_HLS_part requires _HLS_msn",
      status: "invalid",
    });
  });

  test("rejects invalid query params while parsing", () => {
    expect(() =>
      parseHlsBlockingReloadRequest(
        "/v1/live/session_1/v1080/media.m3u8?_HLS_msn=-1"
      )
    ).toThrow("_HLS_msn must be a non-negative integer");
  });

  test("waits for a cursor that satisfies a blocking request", async () => {
    const result = await waitForHlsBlockingReload({
      cursor,
      request: {
        mediaSequenceNumber: 3813,
        partNumber: 0,
      },
      timeoutMs: 100,
      waitForCursor: (context) => {
        expect(context.cursor).toBe(cursor);
        expect(context.signal.aborted).toBe(false);
        return Promise.resolve(advancedCursor);
      },
    });

    expect(result).toEqual({
      cursor: advancedCursor,
      request: {
        mediaSequenceNumber: 3813,
        partNumber: 0,
      },
      status: "ready",
    });
  });

  test("does not wait when the request is already ready", async () => {
    const result = await waitForHlsBlockingReload({
      cursor,
      request: {
        mediaSequenceNumber: 3812,
        partNumber: 1,
      },
      timeoutMs: 100,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(result.status).toBe("ready");
  });

  test("returns invalid without waiting", async () => {
    const result = await waitForHlsBlockingReload({
      cursor,
      request: { partNumber: 0 },
      timeoutMs: 100,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(result).toEqual({
      message: "_HLS_part requires _HLS_msn",
      status: "invalid",
    });
  });

  test("times out when no newer cursor arrives", async () => {
    const result = await waitForHlsBlockingReload({
      cursor,
      request: {
        mediaSequenceNumber: 3813,
      },
      timeoutMs: 0,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(result).toEqual({
      cursor,
      request: {
        mediaSequenceNumber: 3813,
      },
      status: "timeout",
    });
  });

  test("uses injected clock for timeout calculations", async () => {
    let nowCalls = 0;

    const result = await waitForHlsBlockingReload({
      cursor,
      request: {
        mediaSequenceNumber: 3813,
      },
      timeoutMs: 100,
      now: () => {
        nowCalls += 1;

        return nowCalls === 1 ? 1000 : 2000;
      },
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(nowCalls).toBe(2);
    expect(result).toEqual({
      cursor,
      request: {
        mediaSequenceNumber: 3813,
      },
      status: "timeout",
    });
  });

  test("uses injected clock when direct now callback is omitted", async () => {
    let clockCalls = 0;

    const result = await waitForHlsBlockingReload({
      cursor,
      request: {
        mediaSequenceNumber: 3813,
      },
      timeoutMs: 100,
      clock: () => {
        clockCalls += 1;

        return clockCalls === 1 ? 1000 : 2000;
      },
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(clockCalls).toBe(2);
    expect(result).toEqual({
      cursor,
      request: {
        mediaSequenceNumber: 3813,
      },
      status: "timeout",
    });
  });

  test("uses injected sleep for blocking wait timeout", async () => {
    let sleepCalls = 0;

    const result = await waitForHlsBlockingReload({
      cursor,
      request: {
        mediaSequenceNumber: 3813,
      },
      timeoutMs: 100,
      sleep: (durationMs, signal) => {
        sleepCalls += 1;

        expect(durationMs).toBe(100);
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal.aborted).toBe(false);

        return Promise.resolve();
      },
      waitForCursor: () => Promise.resolve(undefined),
    });

    expect(sleepCalls).toBe(1);
    expect(result).toEqual({
      cursor,
      request: {
        mediaSequenceNumber: 3813,
      },
      status: "timeout",
    });
  });

  test("uses the remaining deadline for blocking wait timeout", async () => {
    let nowCalls = 0;
    let sleepDurationMs: number | undefined;

    const result = await waitForHlsBlockingReload({
      cursor,
      request: {
        mediaSequenceNumber: 3813,
      },
      timeoutMs: 100,
      now: () => {
        nowCalls += 1;

        return nowCalls === 1 ? 1000 : 1025;
      },
      sleep: (durationMs) => {
        sleepDurationMs = durationMs;

        return Promise.resolve();
      },
      waitForCursor: () => Promise.resolve(undefined),
    });

    expect(sleepDurationMs).toBe(75);
    expect(result.status).toBe("timeout");
  });
});
