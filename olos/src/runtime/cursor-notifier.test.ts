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
});

function cursorAt(mediaSequenceNumber: number): Cursor {
  return {
    committedWindow: {
      discontinuitySequence: 0,
      epoch: 1,
      firstMediaSequenceNumber: mediaSequenceNumber,
      lastMediaSequenceNumber: mediaSequenceNumber,
      renditions: {
        v1080: {
          init: {
            commitId: "commit_init",
            deliveryUrl: "https://media.example.com/init.mp4",
            objectKey: "media/init.mp4",
            slotId: "slot_init",
          },
          renditionId: "v1080",
          segments: [
            {
              duration: 2,
              mediaSequenceNumber,
              segment: {
                commitId: `commit_${mediaSequenceNumber}`,
                deliveryUrl: `https://media.example.com/${mediaSequenceNumber}.m4s`,
                objectKey: `media/${mediaSequenceNumber}.m4s`,
                slotId: `slot_${mediaSequenceNumber}`,
              },
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
      firstMediaSequenceNumber: mediaSequenceNumber,
      lastMediaSequenceNumber: mediaSequenceNumber,
    },
  };
}
