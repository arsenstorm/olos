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
  duration: 2,
  epoch: 1,
  expiresAt: "2026-01-01T00:00:05.000Z",
  kind: "segment",
  maxBytes: 100_000,
  mediaSequenceNumber: 3810,
  objectKey: "media/3810.m4s",
  renditionId: "v1080",
  sessionId: "session_1",
  slotId: "slot_3810",
  state: "issued",
};

const initCommit: Commit = {
  commitId: "commit_init",
  committedAt: "2026-01-01T00:00:00.000Z",
  deliveryUrl: "/media/v1080/init.mp4",
  duration: 1,
  epoch: 1,
  mediaSequenceNumber: 0,
  objectKey: "media/v1080/init.mp4",
  renditionId: "v1080",
  sessionId: "session_1",
  size: 1024,
  slotId: "slot_init",
};

const segmentCommit: Commit = {
  commitId: "commit_3810",
  committedAt: "2026-01-01T00:00:02.000Z",
  deliveryUrl: "/media/3810.m4s",
  duration: 2,
  epoch: 1,
  mediaSequenceNumber: 3810,
  objectKey: "media/3810.m4s",
  renditionId: "v1080",
  sessionId: "session_1",
  size: 98_304,
  slotId: "slot_3810",
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

  test("rejects invalid retention timestamps", () => {
    expect(() =>
      selectExpiredUploadSlots({
        now: "not-a-date",
        slots: [slot],
      })
    ).toThrow("now must be an ISO timestamp");
  });

  test("selects committed media outside the retained window", () => {
    const commits = [
      segmentCommit,
      {
        ...segmentCommit,
        commitId: "commit_3811",
        mediaSequenceNumber: 3811,
        objectKey: "media/3811.m4s",
        slotId: "slot_3811",
      },
      {
        ...segmentCommit,
        commitId: "commit_3812",
        mediaSequenceNumber: 3812,
        objectKey: "media/3812.m4s",
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
      duration: 0.5,
      objectKey: "media/3810.0.m4s",
      partNumber: 0,
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
