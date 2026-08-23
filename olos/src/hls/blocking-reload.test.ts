import { describe, expect, test } from "bun:test";

import type { Cursor } from "../types/cursor";
import {
  parseHlsBlockingReloadRequest,
  resolveHlsBlockingReload,
  waitForHlsBlockingReload,
} from "./blocking-reload";

const cursor: Cursor = {
  committedWindow: {
    epoch: 1,
    firstSequenceNumber: 3810,
    lastSequenceNumber: 3812,
    tracks: {
      v1080: {
        init: {
          commitId: "commit_init",
          deliveryUrl: "/media/v1080/init.mp4",
          objectKey: "media/v1080/init.mp4",
          slotId: "slot_init",
        },
        segments: [
          {
            parts: [
              {
                commitId: "commit_3812_0",
                deliveryUrl: "/media/3812.0.m4s",
                objectKey: "media/3812.0.m4s",
                partNumber: 0,
                profile: { duration: 0.5 },
                slotId: "slot_3812_0",
              },
              {
                commitId: "commit_3812_1",
                deliveryUrl: "/media/3812.1.m4s",
                objectKey: "media/3812.1.m4s",
                partNumber: 1,
                profile: { duration: 0.5 },
                slotId: "slot_3812_1",
              },
            ],
            sequenceNumber: 3812,
          },
        ],
        trackId: "v1080",
      },
    },
  },
  deliveryBaseUrl: "https://media.example.com",
  epoch: 1,
  olos: "1.0",
  profile: { id: "cmaf-llhls", partTarget: 0.5, segmentTarget: 2 },
  sessionId: "session_1",
  state: "live",
  updatedAt: "2026-01-01T00:00:02.000Z",
  window: {
    firstSequenceNumber: 3810,
    lastPartNumber: 1,
    lastSequenceNumber: 3812,
  },
};

function validTrack() {
  const track = cursor.committedWindow.tracks.v1080;

  if (!track) {
    throw new Error("missing v1080 test fixture");
  }

  return track;
}

const advancedCursor: Cursor = {
  ...cursor,
  committedWindow: {
    ...cursor.committedWindow,
    lastSequenceNumber: 3813,
    tracks: {
      v1080: {
        ...validTrack(),
        segments: [
          ...validTrack().segments,
          {
            parts: [
              {
                commitId: "commit_3813_0",
                deliveryUrl: "/media/3813.0.m4s",
                objectKey: "media/3813.0.m4s",
                partNumber: 0,
                profile: { duration: 0.5 },
                slotId: "slot_3813_0",
              },
            ],
            sequenceNumber: 3813,
          },
        ],
      },
    },
  },
  updatedAt: "2026-01-01T00:00:02.500Z",
  window: {
    ...cursor.window,
    lastPartNumber: 0,
    lastSequenceNumber: 3813,
  },
};

// The audio track lags behind v1080: its own live edge is a full
// segment at 3811 while the window-global edge is 3812 part 1.
const laggingAudioCursor: Cursor = {
  ...cursor,
  committedWindow: {
    ...cursor.committedWindow,
    tracks: {
      ...cursor.committedWindow.tracks,
      a128: {
        init: {
          commitId: "commit_init_a128",
          deliveryUrl: "/media/a128/init.mp4",
          objectKey: "media/a128/init.mp4",
          slotId: "slot_init_a128",
        },
        segments: [
          {
            segment: {
              commitId: "commit_a128_3811",
              deliveryUrl: "/media/a128/3811.m4s",
              objectKey: "media/a128/3811.m4s",
              profile: { duration: 2 },
              slotId: "slot_a128_3811",
            },
            sequenceNumber: 3811,
          },
        ],
        trackId: "a128",
      },
    },
  },
};

function laggingAudioTrack() {
  const track = laggingAudioCursor.committedWindow.tracks.a128;

  if (!track) {
    throw new Error("missing a128 test fixture");
  }

  return track;
}

const caughtUpAudioCursor: Cursor = {
  ...laggingAudioCursor,
  committedWindow: {
    ...laggingAudioCursor.committedWindow,
    tracks: {
      ...laggingAudioCursor.committedWindow.tracks,
      a128: {
        ...laggingAudioTrack(),
        segments: [
          ...laggingAudioTrack().segments,
          {
            segment: {
              commitId: "commit_a128_3812",
              deliveryUrl: "/media/a128/3812.m4s",
              objectKey: "media/a128/3812.m4s",
              profile: { duration: 2 },
              slotId: "slot_a128_3812",
            },
            sequenceNumber: 3812,
          },
        ],
      },
    },
  },
  updatedAt: "2026-01-01T00:00:02.500Z",
};

describe("HLS blocking reload", () => {
  test("parses blocking reload query params", () => {
    expect(
      parseHlsBlockingReloadRequest(
        "/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3812&_HLS_part=1"
      )
    ).toEqual({
      partNumber: 1,
      sequenceNumber: 3812,
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
        partNumber: 1,
        sequenceNumber: 3812,
      })
    ).toEqual({
      request: {
        partNumber: 1,
        sequenceNumber: 3812,
      },
      status: "ready",
    });
  });

  test("returns ready for older media sequences regardless of requested part", () => {
    expect(
      resolveHlsBlockingReload(cursor, {
        partNumber: 999,
        sequenceNumber: 3811,
      })
    ).toEqual({
      request: {
        partNumber: 999,
        sequenceNumber: 3811,
      },
      status: "ready",
    });
  });

  test("blocks when the request is beyond the live cursor", () => {
    expect(
      resolveHlsBlockingReload(cursor, {
        partNumber: 2,
        sequenceNumber: 3812,
      })
    ).toEqual({
      request: {
        partNumber: 2,
        sequenceNumber: 3812,
      },
      status: "block",
    });

    expect(
      resolveHlsBlockingReload(cursor, {
        sequenceNumber: 3813,
      })
    ).toEqual({
      request: {
        sequenceNumber: 3813,
      },
      status: "block",
    });
  });

  test("returns ready for ordinary parts at a segment-only live edge", () => {
    const { lastPartNumber: _lastPartNumber, ...segmentOnlyWindow } =
      cursor.window;

    expect(
      resolveHlsBlockingReload(
        {
          ...cursor,
          committedWindow: {
            ...cursor.committedWindow,
            tracks: {
              v1080: {
                ...validTrack(),
                segments: [
                  {
                    segment: {
                      commitId: "commit_3812",
                      deliveryUrl: "/media/3812.m4s",
                      objectKey: "media/3812.m4s",
                      profile: { duration: 2 },
                      slotId: "slot_3812",
                    },
                    sequenceNumber: 3812,
                  },
                ],
              },
            },
          },
          window: segmentOnlyWindow,
        },
        {
          partNumber: 0,
          sequenceNumber: 3812,
        }
      )
    ).toEqual({
      request: {
        partNumber: 0,
        sequenceNumber: 3812,
      },
      status: "ready",
    });
  });

  test("resolves per-track bounds when a trackId is set", () => {
    expect(
      resolveHlsBlockingReload(laggingAudioCursor, {
        sequenceNumber: 3812,
        trackId: "a128",
      })
    ).toEqual({
      request: { sequenceNumber: 3812, trackId: "a128" },
      status: "block",
    });

    // The same request without a track context resolves against the
    // window-global live edge and is already servable.
    expect(
      resolveHlsBlockingReload(laggingAudioCursor, {
        sequenceNumber: 3812,
      })
    ).toEqual({
      request: { sequenceNumber: 3812 },
      status: "ready",
    });
  });

  test("waits until the requested track itself reaches the position", async () => {
    const result = await waitForHlsBlockingReload({
      cursor: laggingAudioCursor,
      request: { sequenceNumber: 3812, trackId: "a128" },
      timeoutMs: 100,
      waitForCursor: () => Promise.resolve(caughtUpAudioCursor),
    });

    expect(result).toEqual({
      cursor: caughtUpAudioCursor,
      request: { sequenceNumber: 3812, trackId: "a128" },
      status: "ready",
    });
  });

  test("treats a full-segment track tail as a segment-only live edge", () => {
    // cursor.window.lastPartNumber is 1 (set by v1080), but a128's own tail
    // is a full segment — part requests at its live edge never block.
    expect(
      resolveHlsBlockingReload(laggingAudioCursor, {
        partNumber: 4,
        sequenceNumber: 3811,
        trackId: "a128",
      })
    ).toEqual({
      request: {
        partNumber: 4,
        sequenceNumber: 3811,
        trackId: "a128",
      },
      status: "ready",
    });
  });

  test("blocks for tracks absent from the window until they appear", async () => {
    expect(
      resolveHlsBlockingReload(cursor, {
        sequenceNumber: 3810,
        trackId: "a128",
      })
    ).toEqual({
      request: { sequenceNumber: 3810, trackId: "a128" },
      status: "block",
    });

    const result = await waitForHlsBlockingReload({
      cursor,
      request: { sequenceNumber: 3810, trackId: "a128" },
      timeoutMs: 100,
      waitForCursor: () => Promise.resolve(laggingAudioCursor),
    });

    expect(result).toEqual({
      cursor: laggingAudioCursor,
      request: { sequenceNumber: 3810, trackId: "a128" },
      status: "ready",
    });
  });

  test("resolves immediately when a terminal cursor arrives mid-wait", async () => {
    const terminalCursor: Cursor = { ...cursor, state: "ended" };
    let waiterCalls = 0;

    const result = await waitForHlsBlockingReload({
      cursor,
      request: { sequenceNumber: 3814 },
      timeoutMs: 10_000,
      waitForCursor: () => {
        waiterCalls += 1;
        return Promise.resolve(terminalCursor);
      },
    });

    expect(waiterCalls).toBe(1);
    expect(result).toEqual({
      cursor: terminalCursor,
      request: { sequenceNumber: 3814 },
      status: "timeout",
    });
  });

  test("throws when waitForCursor produces a malformed cursor", async () => {
    await expect(
      waitForHlsBlockingReload({
        cursor,
        request: { sequenceNumber: 3813 },
        timeoutMs: 100,
        waitForCursor: () =>
          Promise.resolve({
            ...cursor,
            window: { ...cursor.window, lastPartNumber: 7 },
          }),
      })
    ).rejects.toThrow(
      "cursor.window.lastPartNumber must equal the committed window's last visible part number"
    );
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
    expect(() =>
      parseHlsBlockingReloadRequest(
        "/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3812&_HLS_part=-1"
      )
    ).toThrow("_HLS_part must be a non-negative integer");
  });

  test("rejects non-canonical integer literals for _HLS_msn", () => {
    for (const value of ["", "0x10", "1e3", " 5", "+5"]) {
      expect(() =>
        parseHlsBlockingReloadRequest(
          `/v1/live/session_1/v1080/media.m3u8?_HLS_msn=${encodeURIComponent(value)}`
        )
      ).toThrow("_HLS_msn must be a non-negative integer");
    }
  });

  test("waits for a cursor that satisfies a blocking request", async () => {
    const result = await waitForHlsBlockingReload({
      cursor,
      request: {
        partNumber: 0,
        sequenceNumber: 3813,
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
        partNumber: 0,
        sequenceNumber: 3813,
      },
      status: "ready",
    });
  });

  test("does not wait when the request is already ready", async () => {
    const result = await waitForHlsBlockingReload({
      cursor,
      request: {
        partNumber: 1,
        sequenceNumber: 3812,
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
        sequenceNumber: 3813,
      },
      timeoutMs: 0,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(result).toEqual({
      cursor,
      request: {
        sequenceNumber: 3813,
      },
      status: "timeout",
    });
  });

  test("resolves immediately for terminal sessions without waiting", async () => {
    for (const state of ["ended", "aborted"] as const) {
      const terminalCursor = { ...cursor, state };
      const result = await waitForHlsBlockingReload({
        cursor: terminalCursor,
        request: {
          sequenceNumber: 3813,
        },
        timeoutMs: 100,
        waitForCursor: () =>
          Promise.reject(new Error("waiter should not be called")),
      });

      expect(result).toEqual({
        cursor: terminalCursor,
        request: {
          sequenceNumber: 3813,
        },
        status: "timeout",
      });
    }
  });

  test("uses injected clock for timeout calculations", async () => {
    let nowCalls = 0;

    const result = await waitForHlsBlockingReload({
      cursor,
      now: () => {
        nowCalls += 1;

        return nowCalls === 1 ? 1000 : 2000;
      },
      request: {
        sequenceNumber: 3813,
      },
      timeoutMs: 100,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(nowCalls).toBe(2);
    expect(result).toEqual({
      cursor,
      request: {
        sequenceNumber: 3813,
      },
      status: "timeout",
    });
  });

  test("uses injected sleep for blocking wait timeout", async () => {
    let sleepCalls = 0;

    const result = await waitForHlsBlockingReload({
      cursor,
      now: () => 1000,
      request: {
        sequenceNumber: 3813,
      },
      sleep: (durationMs, signal) => {
        sleepCalls += 1;

        expect(durationMs).toBe(100);
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal.aborted).toBe(false);

        return Promise.resolve();
      },
      timeoutMs: 100,
      waitForCursor: () => Promise.resolve(undefined),
    });

    expect(sleepCalls).toBe(1);
    expect(result).toEqual({
      cursor,
      request: {
        sequenceNumber: 3813,
      },
      status: "timeout",
    });
  });

  test("times out with current cursor when waiter returns no cursor", async () => {
    const result = await waitForHlsBlockingReload({
      cursor,
      request: {
        sequenceNumber: 3813,
      },
      sleep: () => Promise.resolve(),
      timeoutMs: 100,
      waitForCursor: () => Promise.resolve(undefined),
    });

    expect(result).toEqual({
      cursor,
      request: {
        sequenceNumber: 3813,
      },
      status: "timeout",
    });
  });

  test("uses the remaining deadline for blocking wait timeout", async () => {
    let nowCalls = 0;
    let sleepDurationMs: number | undefined;

    const result = await waitForHlsBlockingReload({
      cursor,
      now: () => {
        nowCalls += 1;

        return nowCalls === 1 ? 1000 : 1025;
      },
      request: {
        sequenceNumber: 3813,
      },
      sleep: (durationMs) => {
        sleepDurationMs = durationMs;

        return Promise.resolve();
      },
      timeoutMs: 100,
      waitForCursor: () => Promise.resolve(undefined),
    });

    expect(sleepDurationMs).toBe(75);
    expect(result.status).toBe("timeout");
  });
});
