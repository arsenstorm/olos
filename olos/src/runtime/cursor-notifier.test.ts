import { describe, expect, test } from "bun:test";
import type { Cursor } from "../types/cursor";
import { createMemoryRuntimeCursorNotifier } from "./cursor-notifier";

describe("runtime cursor notifier", () => {
  test("resolves waiters when a later cursor is notified", async () => {
    const notifier = createMemoryRuntimeCursorNotifier();
    const controller = new AbortController();
    const waiting = notifier.waitForCursor({
      cursor: cursorAt(3810),
      request: { sequenceNumber: 3811 },
      signal: controller.signal,
    });

    notifier.notify(cursorAt(3811));

    await expect(waiting).resolves.toMatchObject({
      window: { lastSequenceNumber: 3811 },
    });
  });

  test("keeps waiters pending when an equivalent cursor is notified", async () => {
    const notifier = createMemoryRuntimeCursorNotifier();
    const controller = new AbortController();
    const waiting = notifier.waitForCursor({
      cursor: cursorAt(3810),
      request: { sequenceNumber: 3811 },
      signal: controller.signal,
    });

    notifier.notify(cursorAt(3810));
    notifier.notify(cursorAt(3811));

    await expect(waiting).resolves.toMatchObject({
      window: { lastSequenceNumber: 3811 },
    });
  });

  test("wakes waiters when window content changes at the same position", async () => {
    const notifier = createMemoryRuntimeCursorNotifier();
    const controller = new AbortController();
    const waiting = notifier.waitForCursor({
      cursor: cursorAt(3811),
      request: { sequenceNumber: 3811, trackId: "a128" },
      signal: controller.signal,
    });

    // A lagging track committing at the live-edge msn changes the
    // window without moving the global (epoch, msn, part) position
    // (§4.5.3); per-track waiters may be blocked exactly on it.
    const changed = withAudioTrack(cursorAt(3811));

    notifier.notify(changed);

    await expect(waiting).resolves.toEqual(changed);
  });

  test("replaces the latest cursor on same-position content changes", async () => {
    const notifier = createMemoryRuntimeCursorNotifier();
    const changed = withAudioTrack(cursorAt(3811));

    notifier.notify(cursorAt(3811));
    notifier.notify(changed);

    // A waiter arriving after the notification must resolve from memory
    // with the changed cursor, not park behind the superseded one.
    await expect(
      notifier.waitForCursor({
        cursor: cursorAt(3811),
        request: { sequenceNumber: 3811, trackId: "a128" },
        signal: new AbortController().signal,
      })
    ).resolves.toEqual(changed);
  });

  test("resolves waiters when the cursor epoch advances", async () => {
    const notifier = createMemoryRuntimeCursorNotifier();
    const controller = new AbortController();
    const waiting = notifier.waitForCursor({
      cursor: cursorAt(3810),
      request: { sequenceNumber: 3810 },
      signal: controller.signal,
    });

    notifier.notify(cursorAt(3810, 2));

    await expect(waiting).resolves.toMatchObject({
      epoch: 2,
      window: { lastSequenceNumber: 3810 },
    });
  });

  test("resolves waiters when the cursor part advances", async () => {
    const notifier = createMemoryRuntimeCursorNotifier();
    const controller = new AbortController();
    const waiting = notifier.waitForCursor({
      cursor: cursorAt(3810, 1, 0),
      request: { sequenceNumber: 3810, partNumber: 1 },
      signal: controller.signal,
    });

    notifier.notify(cursorAt(3810, 1, 1));

    await expect(waiting).resolves.toMatchObject({
      window: { lastSequenceNumber: 3810, lastPartNumber: 1 },
    });
  });

  test("returns the latest cursor when it already advanced", async () => {
    const notifier = createMemoryRuntimeCursorNotifier();

    notifier.notify(cursorAt(3811));

    await expect(
      notifier.waitForCursor({
        cursor: cursorAt(3810),
        request: { sequenceNumber: 3811 },
        signal: new AbortController().signal,
      })
    ).resolves.toMatchObject({
      window: { lastSequenceNumber: 3811 },
    });
  });

  test("resolves undefined when the wait is aborted", async () => {
    const notifier = createMemoryRuntimeCursorNotifier();
    const controller = new AbortController();
    const waiting = notifier.waitForCursor({
      cursor: cursorAt(3810),
      request: { sequenceNumber: 3811 },
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
      request: { sequenceNumber: 3811 },
      signal: controller.signal,
    });

    controller.abort();

    await expect(waiting).resolves.toBeUndefined();
  });

  test("still resolves live waiters from a terminal cursor notification", async () => {
    const notifier = createMemoryRuntimeCursorNotifier();
    const waiting = notifier.waitForCursor({
      cursor: cursorAt(3810),
      request: { sequenceNumber: 3811 },
      signal: new AbortController().signal,
    });

    notifier.notify({ ...cursorAt(3811), state: "ended" });

    await expect(waiting).resolves.toMatchObject({
      state: "ended",
      window: { lastSequenceNumber: 3811 },
    });
  });
});

function withAudioTrack(base: Cursor): Cursor {
  const sequenceNumber = base.window.lastSequenceNumber;

  return {
    ...base,
    committedWindow: {
      ...base.committedWindow,
      tracks: {
        ...base.committedWindow.tracks,
        a128: {
          init: {
            commitId: "commit_init_a128",
            deliveryUrl: "https://media.example.com/media/a128/init.mp4",
            objectKey: "media/a128/init.mp4",
            slotId: "slot_init_a128",
          },
          trackId: "a128",
          segments: [
            {
              sequenceNumber,
              segment: {
                commitId: `commit_a128_${sequenceNumber}`,
                deliveryUrl: `https://media.example.com/a128/${sequenceNumber}.m4s`,
                objectKey: `media/a128/${sequenceNumber}.m4s`,
                profile: { duration: 2 },
                slotId: `slot_a128_${sequenceNumber}`,
              },
            },
          ],
        },
      },
    },
    updatedAt: "2026-01-01T00:00:03.000Z",
  };
}

function cursorAt(
  sequenceNumber: number,
  epoch = 1,
  lastPartNumber?: number
): Cursor {
  return {
    committedWindow: {
      epoch,
      firstSequenceNumber: sequenceNumber,
      lastSequenceNumber: sequenceNumber,
      tracks: {
        v1080: {
          init: {
            commitId: "commit_init",
            deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
            objectKey: "media/v1080/init.mp4",
            slotId: "slot_init",
          },
          trackId: "v1080",
          segments: [
            lastPartNumber === undefined
              ? {
                  sequenceNumber,
                  segment: {
                    commitId: `commit_${sequenceNumber}`,
                    deliveryUrl: `https://media.example.com/${sequenceNumber}.m4s`,
                    objectKey: `media/${sequenceNumber}.m4s`,
                    profile: { duration: 2 },
                    slotId: `slot_${sequenceNumber}`,
                  },
                }
              : {
                  sequenceNumber,
                  // The window must show every claimed part (§3.8).
                  parts: Array.from(
                    { length: lastPartNumber + 1 },
                    (_, partNumber) => ({
                      commitId: `commit_${sequenceNumber}_${partNumber}`,
                      deliveryUrl: `https://media.example.com/${sequenceNumber}.${partNumber}.m4s`,
                      objectKey: `media/${sequenceNumber}.${partNumber}.m4s`,
                      partNumber,
                      profile: {
                        duration: 0.5,
                        ...(partNumber === 0 ? { independent: true } : {}),
                      },
                      slotId: `slot_${sequenceNumber}_${partNumber}`,
                    })
                  ),
                },
          ],
        },
      },
    },
    epoch,
    olos: "1.0",
    deliveryBaseUrl: "https://media.example.com",
    profile: { id: "cmaf-llhls", partTarget: 0.5, segmentTarget: 2 },
    sessionId: "session_1",
    state: "live",
    updatedAt: "2026-01-01T00:00:02.000Z",
    window: {
      firstSequenceNumber: sequenceNumber,
      lastSequenceNumber: sequenceNumber,
      ...(lastPartNumber === undefined ? {} : { lastPartNumber }),
    },
  };
}
