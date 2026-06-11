import { describe, expect, test } from "bun:test";
import type { Commit } from "../types/commit";
import { createCommittedWindow } from "./committed-window";

const initCommit: Commit = {
  commitId: "commit_init",
  committedAt: "2026-01-01T00:00:00.000Z",
  deliveryUrl: "/media/v1080/init.mp4",
  duration: 1,
  epoch: 1,
  mediaSequenceNumber: 0,
  objectKey: "media/v1080/init.mp4",
  providerId: "r2_primary",
  publicationMode: "direct-public",
  renditionId: "v1080",
  sessionId: "session_1",
  size: 1024,
  slotId: "slot_init",
};

const segmentCommit: Commit = {
  commitId: "commit_3810",
  committedAt: "2026-01-01T00:00:02.000Z",
  deliveryUrl: "/media/v1080/3810.m4s",
  duration: 2,
  epoch: 1,
  mediaSequenceNumber: 3810,
  objectKey: "media/v1080/3810.m4s",
  providerId: "r2_primary",
  publicationMode: "direct-public",
  renditionId: "v1080",
  sessionId: "session_1",
  size: 98_304,
  slotId: "slot_3810",
};

function partCommit(partNumber: number): Commit {
  return {
    commitId: `commit_3811_${partNumber}`,
    committedAt: "2026-01-01T00:00:03.000Z",
    deliveryUrl: `/media/v1080/3811.${partNumber}.m4s`,
    duration: 0.5,
    epoch: 1,
    independent: partNumber === 0,
    mediaSequenceNumber: 3811,
    objectKey: `/media/v1080/3811.${partNumber}.m4s`,
    partNumber,
    providerId: "r2_primary",
    publicationMode: "direct-public",
    renditionId: "v1080",
    sessionId: "session_1",
    size: 24_576,
    slotId: `slot_3811_${partNumber}`,
  };
}

describe("committed window builder", () => {
  test("creates a committed window from commits", () => {
    expect(
      createCommittedWindow({
        commits: [partCommit(1), segmentCommit, partCommit(0)],
        epoch: 1,
        initCommits: [initCommit],
        sessionId: "session_1",
      })
    ).toEqual({
      discontinuitySequence: 0,
      epoch: 1,
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3811,
      renditions: {
        v1080: {
          init: {
            commitId: "commit_init",
            deliveryUrl: "/media/v1080/init.mp4",
            duration: 1,
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
                deliveryUrl: "/media/v1080/3810.m4s",
                duration: 2,
                objectKey: "media/v1080/3810.m4s",
                slotId: "slot_3810",
              },
            },
            {
              duration: 0.5,
              mediaSequenceNumber: 3811,
              parts: [
                {
                  commitId: "commit_3811_0",
                  deliveryUrl: "/media/v1080/3811.0.m4s",
                  duration: 0.5,
                  independent: true,
                  objectKey: "/media/v1080/3811.0.m4s",
                  partNumber: 0,
                  slotId: "slot_3811_0",
                },
                {
                  commitId: "commit_3811_1",
                  deliveryUrl: "/media/v1080/3811.1.m4s",
                  duration: 0.5,
                  independent: false,
                  objectKey: "/media/v1080/3811.1.m4s",
                  partNumber: 1,
                  slotId: "slot_3811_1",
                },
              ],
            },
          ],
        },
      },
    });
  });

  test("limits the committed window to the newest segments", () => {
    const window = createCommittedWindow({
      commits: [
        segmentCommit,
        {
          ...segmentCommit,
          commitId: "commit_3811",
          mediaSequenceNumber: 3811,
        },
      ],
      epoch: 1,
      initCommits: [initCommit],
      maxSegments: 1,
      sessionId: "session_1",
    });

    expect(window.firstMediaSequenceNumber).toBe(3811);
    expect(window.lastMediaSequenceNumber).toBe(3811);
    expect(window.renditions.v1080?.segments).toHaveLength(1);
  });

  test("rejects empty init commits", () => {
    expect(() =>
      createCommittedWindow({
        commits: [segmentCommit],
        epoch: 1,
        initCommits: [],
        sessionId: "session_1",
      })
    ).toThrow("initCommits must be a non-empty array");
  });

  test("rejects empty media commits", () => {
    expect(() =>
      createCommittedWindow({
        commits: [],
        epoch: 1,
        initCommits: [initCommit],
        sessionId: "session_1",
      })
    ).toThrow("commits must be a non-empty array");
  });

  test("rejects commits from other sessions", () => {
    expect(() =>
      createCommittedWindow({
        commits: [{ ...segmentCommit, sessionId: "other_session" }],
        epoch: 1,
        initCommits: [initCommit],
        sessionId: "session_1",
      })
    ).toThrow("commit.sessionId must match sessionId");
  });

  test("rejects commits from other epochs", () => {
    expect(() =>
      createCommittedWindow({
        commits: [{ ...segmentCommit, epoch: 2 }],
        epoch: 1,
        initCommits: [initCommit],
        sessionId: "session_1",
      })
    ).toThrow("commit.epoch must match epoch");
  });

  test("rejects media commits without init commits", () => {
    expect(() =>
      createCommittedWindow({
        commits: [{ ...segmentCommit, renditionId: "v720" }],
        epoch: 1,
        initCommits: [initCommit],
        sessionId: "session_1",
      })
    ).toThrow("missing init commit for rendition: v720");
  });

  test("rejects duplicate segment commits", () => {
    expect(() =>
      createCommittedWindow({
        commits: [segmentCommit, segmentCommit],
        epoch: 1,
        initCommits: [initCommit],
        sessionId: "session_1",
      })
    ).toThrow("commits must not contain duplicate segment positions");
  });
});
