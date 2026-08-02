import { describe, expect, test } from "bun:test";
import type { Cursor } from "../types/cursor";
import { createMemoryRuntimeCursorNotifier } from "./cursor-notifier";

describe("runtime cursor notifier", () => {
  test("resolves waiters when a later cursor is notified", async () => {
    const notifier = createMemoryRuntimeCursorNotifier();
    const controller = new AbortController();
    const waiting = notifier.waitForCursor({
      cursor: cursorAt(3810),
      request: { mediaSequenceNumber: 3811 },
      signal: controller.signal,
    });

    notifier.notify(cursorAt(3811));

    await expect(waiting).resolves.toMatchObject({
      window: { lastMediaSequenceNumber: 3811 },
    });
  });

  test("keeps waiters pending when an equivalent cursor is notified", async () => {
    const notifier = createMemoryRuntimeCursorNotifier();
    const controller = new AbortController();
    const waiting = notifier.waitForCursor({
      cursor: cursorAt(3810),
      request: { mediaSequenceNumber: 3811 },
      signal: controller.signal,
    });

    notifier.notify(cursorAt(3810));
    notifier.notify(cursorAt(3811));

    await expect(waiting).resolves.toMatchObject({
      window: { lastMediaSequenceNumber: 3811 },
    });
  });

  test("resolves waiters when the cursor epoch advances", async () => {
    const notifier = createMemoryRuntimeCursorNotifier();
    const controller = new AbortController();
    const waiting = notifier.waitForCursor({
      cursor: cursorAt(3810),
      request: { mediaSequenceNumber: 3810 },
      signal: controller.signal,
    });

    notifier.notify(cursorAt(3810, 2));

    await expect(waiting).resolves.toMatchObject({
      epoch: 2,
      window: { lastMediaSequenceNumber: 3810 },
    });
  });

  test("resolves waiters when the cursor part advances", async () => {
    const notifier = createMemoryRuntimeCursorNotifier();
    const controller = new AbortController();
    const waiting = notifier.waitForCursor({
      cursor: cursorAt(3810, 1, 0),
      request: { mediaSequenceNumber: 3810, partNumber: 1 },
      signal: controller.signal,
    });

    notifier.notify(cursorAt(3810, 1, 1));

    await expect(waiting).resolves.toMatchObject({
      window: { lastMediaSequenceNumber: 3810, lastPartNumber: 1 },
    });
  });

  test("returns the latest cursor when it already advanced", async () => {
    const notifier = createMemoryRuntimeCursorNotifier();

    notifier.notify(cursorAt(3811));

    await expect(
      notifier.waitForCursor({
        cursor: cursorAt(3810),
        request: { mediaSequenceNumber: 3811 },
        signal: new AbortController().signal,
      })
    ).resolves.toMatchObject({
      window: { lastMediaSequenceNumber: 3811 },
    });
  });

  test("resolves undefined when the wait is aborted", async () => {
    const notifier = createMemoryRuntimeCursorNotifier();
    const controller = new AbortController();
    const waiting = notifier.waitForCursor({
      cursor: cursorAt(3810),
      request: { mediaSequenceNumber: 3811 },
      signal: controller.signal,
    });

    controller.abort();

    await expect(waiting).resolves.toBeUndefined();
  });

  test("evicts the latest cursor once a session turns terminal", async () => {
    const notifier = createMemoryRuntimeCursorNotifier();

    notifier.notify(cursorAt(3811));
    notifier.notify({ ...cursorAt(3812), state: "ended" });

    // Without the tracked cursor, a later wait behind the evicted position
    // blocks instead of resolving from memory; terminal sessions resolve
    // from the stored cursor before ever reaching the notifier.
    const controller = new AbortController();
    const waiting = notifier.waitForCursor({
      cursor: cursorAt(3810),
      request: { mediaSequenceNumber: 3811 },
      signal: controller.signal,
    });

    controller.abort();

    await expect(waiting).resolves.toBeUndefined();
  });

  test("still resolves live waiters from a terminal cursor notification", async () => {
    const notifier = createMemoryRuntimeCursorNotifier();
    const waiting = notifier.waitForCursor({
      cursor: cursorAt(3810),
      request: { mediaSequenceNumber: 3811 },
      signal: new AbortController().signal,
    });

    notifier.notify({ ...cursorAt(3811), state: "ended" });

    await expect(waiting).resolves.toMatchObject({
      state: "ended",
      window: { lastMediaSequenceNumber: 3811 },
    });
  });
});

function cursorAt(
  mediaSequenceNumber: number,
  epoch = 1,
  lastPartNumber?: number
): Cursor {
  return {
    committedWindow: {
      discontinuitySequence: 0,
      epoch,
      firstMediaSequenceNumber: mediaSequenceNumber,
      lastMediaSequenceNumber: mediaSequenceNumber,
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
            lastPartNumber === undefined
              ? {
                  duration: 2,
                  mediaSequenceNumber,
                  segment: {
                    commitId: `commit_${mediaSequenceNumber}`,
                    deliveryUrl: `https://media.example.com/${mediaSequenceNumber}.m4s`,
                    objectKey: `media/${mediaSequenceNumber}.m4s`,
                    slotId: `slot_${mediaSequenceNumber}`,
                  },
                }
              : {
                  duration: (lastPartNumber + 1) * 0.5,
                  mediaSequenceNumber,
                  // The window must show every claimed part (§3.8).
                  parts: Array.from(
                    { length: lastPartNumber + 1 },
                    (_, partNumber) => ({
                      commitId: `commit_${mediaSequenceNumber}_${partNumber}`,
                      deliveryUrl: `https://media.example.com/${mediaSequenceNumber}.${partNumber}.m4s`,
                      duration: 0.5,
                      ...(partNumber === 0 ? { independent: true } : {}),
                      objectKey: `media/${mediaSequenceNumber}.${partNumber}.m4s`,
                      partNumber,
                      slotId: `slot_${mediaSequenceNumber}_${partNumber}`,
                    })
                  ),
                },
          ],
        },
      },
    },
    epoch,
    latencyProfile: "object-ll",
    olos: "1.0",
    mediaBaseUrl: "https://media.example.com",
    partTarget: 0.5,
    segmentTarget: 2,
    sessionId: "session_1",
    state: "live",
    updatedAt: "2026-01-01T00:00:02.000Z",
    window: {
      firstMediaSequenceNumber: mediaSequenceNumber,
      lastMediaSequenceNumber: mediaSequenceNumber,
      ...(lastPartNumber === undefined ? {} : { lastPartNumber }),
    },
  };
}
