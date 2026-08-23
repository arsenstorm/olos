import { describe, expect, test } from "bun:test";
import type { Commit } from "../types/commit";
import type { UploadSlot } from "../types/upload-slot";
import { createCommittedWindow } from "./committed-window";
import {
  selectExpiredUploadSlots,
  selectRetiredCommittedObjects,
} from "./retention";

const slot: UploadSlot = {
  contentType: "video/mp4",
  deliveryUrl: "https://media.example.com/media/3810.m4s",
  epoch: 1,
  expiresAt: "2026-01-01T00:00:05.000Z",
  kind: "segment",
  maxBytes: 100_000,
  objectKey: "media/3810.m4s",
  profile: { duration: 2 },
  sequenceNumber: 3810,
  sessionId: "session_1",
  slotId: "slot_3810",
  state: "issued",
  trackId: "v1080",
};

const initCommit: Commit = {
  commitId: "commit_init",
  committedAt: "2026-01-01T00:00:00.000Z",
  deliveryUrl: "/media/v1080/init.mp4",
  epoch: 1,
  objectKey: "media/v1080/init.mp4",
  profile: { duration: 1 },
  sequenceNumber: 0,
  sessionId: "session_1",
  size: 1024,
  slotId: "slot_init",
  trackId: "v1080",
};

const segmentCommit: Commit = {
  commitId: "commit_3810",
  committedAt: "2026-01-01T00:00:02.000Z",
  deliveryUrl: "/media/3810.m4s",
  epoch: 1,
  objectKey: "media/3810.m4s",
  profile: { duration: 2 },
  sequenceNumber: 3810,
  sessionId: "session_1",
  size: 98_304,
  slotId: "slot_3810",
  trackId: "v1080",
};

describe("retention planning", () => {
  test("selects expired issued upload slots", () => {
    expect(
      selectExpiredUploadSlots({
        now: "2026-01-01T00:00:05.000Z",
        slots: [
          slot,
          {
            ...slot,
            expiresAt: "2026-01-01T00:00:06.000Z",
            slotId: "slot_future",
          },
          {
            ...slot,
            slotId: "slot_committed",
            state: "committed",
          },
        ],
      }).map((expired) => expired.slotId)
    ).toEqual(["slot_3810"]);
  });

  test("keeps issued slots within the late tolerance window", () => {
    // expiresAt is 00:00:05; with 5s tolerance the slot survives until
    // 00:00:10 and is pruned exactly at the tolerated boundary.
    expect(
      selectExpiredUploadSlots({
        lateToleranceMs: 5000,
        now: "2026-01-01T00:00:09.999Z",
        slots: [slot],
      })
    ).toEqual([]);
    expect(
      selectExpiredUploadSlots({
        lateToleranceMs: 5000,
        now: "2026-01-01T00:00:10.000Z",
        slots: [slot],
      }).map((expired) => expired.slotId)
    ).toEqual(["slot_3810"]);
  });

  test("rejects invalid retention timestamps", () => {
    expect(() =>
      selectExpiredUploadSlots({
        now: "not-a-date",
        slots: [slot],
      })
    ).toThrow("now must be an ISO timestamp");
  });

  test("rejects negative late tolerances", () => {
    expect(() =>
      selectExpiredUploadSlots({
        lateToleranceMs: -1,
        now: "2026-01-01T00:00:05.000Z",
        slots: [slot],
      })
    ).toThrow("lateToleranceMs must be a non-negative number");
  });

  test("selects committed media outside the retained window", () => {
    const commits = [
      segmentCommit,
      {
        ...segmentCommit,
        commitId: "commit_3811",
        objectKey: "media/3811.m4s",
        sequenceNumber: 3811,
        slotId: "slot_3811",
      },
      {
        ...segmentCommit,
        commitId: "commit_3812",
        objectKey: "media/3812.m4s",
        sequenceNumber: 3812,
        slotId: "slot_3812",
      },
    ];
    const retainedWindow = createCommittedWindow({
      commits,
      epoch: 1,
      initCommits: [initCommit],
      maxSegments: 2,
      sessionId: "session_1",
    });

    expect(
      selectRetiredCommittedObjects({
        commits,
        retainedWindow,
      })
    ).toEqual([
      {
        commitId: "commit_3810",
        objectKey: "media/3810.m4s",
        slotId: "slot_3810",
      },
    ]);
  });

  test("retires trimmed commits per track despite a lagging track", () => {
    const audioInitCommit: Commit = {
      ...initCommit,
      commitId: "commit_init_a128",
      deliveryUrl: "/media/a128/init.mp4",
      objectKey: "media/a128/init.mp4",
      slotId: "slot_init_a128",
      trackId: "a128",
    };
    const audioSegmentCommit: Commit = {
      ...segmentCommit,
      commitId: "commit_a128_3810",
      deliveryUrl: "/media/a128/3810.m4s",
      objectKey: "media/a128/3810.m4s",
      slotId: "slot_a128_3810",
      trackId: "a128",
    };
    const commits = [
      segmentCommit,
      {
        ...segmentCommit,
        commitId: "commit_3811",
        objectKey: "media/3811.m4s",
        sequenceNumber: 3811,
        slotId: "slot_3811",
      },
      {
        ...segmentCommit,
        commitId: "commit_3812",
        objectKey: "media/3812.m4s",
        sequenceNumber: 3812,
        slotId: "slot_3812",
      },
      audioSegmentCommit,
    ];
    const retainedWindow = createCommittedWindow({
      commits,
      epoch: 1,
      initCommits: [initCommit, audioInitCommit],
      maxSegments: 2,
      sessionId: "session_1",
    });

    // Audio pins the window-global first media sequence at 3810, but video's
    // own first visible segment is 3811 — its trimmed 3810 commit retires
    // while audio's still-visible 3810 commit is kept.
    expect(
      selectRetiredCommittedObjects({
        commits,
        retainedWindow,
      })
    ).toEqual([
      {
        commitId: "commit_3810",
        objectKey: "media/3810.m4s",
        slotId: "slot_3810",
      },
    ]);
  });

  test("keeps commits of tracks absent from the retained window", () => {
    const audioInitCommit: Commit = {
      ...initCommit,
      commitId: "commit_init_a128",
      deliveryUrl: "/media/a128/init.mp4",
      objectKey: "media/a128/init.mp4",
      slotId: "slot_init_a128",
      trackId: "a128",
    };
    // Audio's only commit is an out-of-order part below the window-global
    // first media sequence, so audio is absent from the window; the commit
    // must survive since it may still become visible.
    const audioPartCommit: Commit = {
      ...segmentCommit,
      commitId: "commit_a128_3809_1",
      deliveryUrl: "/media/a128/3809.1.m4s",
      objectKey: "media/a128/3809.1.m4s",
      partNumber: 1,
      profile: { duration: 0.5 },
      sequenceNumber: 3809,
      slotId: "slot_a128_3809_1",
      trackId: "a128",
    };
    const retainedWindow = createCommittedWindow({
      commits: [segmentCommit, audioPartCommit],
      epoch: 1,
      initCommits: [initCommit, audioInitCommit],
      sessionId: "session_1",
    });

    expect(retainedWindow.tracks.a128).toBeUndefined();
    expect(
      selectRetiredCommittedObjects({
        commits: [segmentCommit, audioPartCommit],
        retainedWindow,
      })
    ).toEqual([]);
  });

  test("keeps retained init media out of retired committed objects", () => {
    const retainedWindow = createCommittedWindow({
      commits: [segmentCommit],
      epoch: 1,
      initCommits: [initCommit],
      maxSegments: 2,
      sessionId: "session_1",
    });

    expect(
      selectRetiredCommittedObjects({
        commits: [initCommit, segmentCommit],
        retainedWindow,
      })
    ).toEqual([]);
  });

  test("keeps retained part media out of retired committed objects", () => {
    const partCommit = {
      ...segmentCommit,
      commitId: "commit_3810_0",
      objectKey: "media/3810.0.m4s",
      partNumber: 0,
      profile: { duration: 0.5 },
      slotId: "slot_3810_0",
    };
    const retainedWindow = createCommittedWindow({
      commits: [partCommit],
      epoch: 1,
      initCommits: [initCommit],
      maxSegments: 2,
      sessionId: "session_1",
    });

    expect(
      selectRetiredCommittedObjects({
        commits: [partCommit],
        retainedWindow,
      })
    ).toEqual([]);
  });
});
