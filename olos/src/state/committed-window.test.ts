import { describe, expect, test } from "bun:test";
import type { Commit } from "../types/commit";
import {
  createCommittedWindow,
  lastVisiblePartNumber,
  trackWindowBounds,
  tryCreateCommittedWindow,
} from "./committed-window";

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
  deliveryUrl: "/media/v1080/s3810.m4s",
  epoch: 1,
  objectKey: "media/v1080/s3810.m4s",
  profile: { duration: 2 },
  sequenceNumber: 3810,
  sessionId: "session_1",
  size: 98_304,
  slotId: "slot_3810",
  trackId: "v1080",
};

function partCommit(partNumber: number): Commit {
  return {
    commitId: `commit_3811_${partNumber}`,
    committedAt: "2026-01-01T00:00:03.000Z",
    deliveryUrl: `/media/v1080/3811.${partNumber}.m4s`,
    epoch: 1,
    objectKey: `media/v1080/3811.${partNumber}.m4s`,
    partNumber,
    profile: { duration: 0.5, independent: partNumber === 0 },
    sequenceNumber: 3811,
    sessionId: "session_1",
    size: 24_576,
    slotId: `slot_3811_${partNumber}`,
    trackId: "v1080",
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
      epoch: 1,
      firstSequenceNumber: 3810,
      lastSequenceNumber: 3811,
      tracks: {
        v1080: {
          init: {
            commitId: "commit_init",
            deliveryUrl: "/media/v1080/init.mp4",
            objectKey: "media/v1080/init.mp4",
            profile: { duration: 1 },
            slotId: "slot_init",
          },
          segments: [
            {
              segment: {
                commitId: "commit_3810",
                deliveryUrl: "/media/v1080/s3810.m4s",
                objectKey: "media/v1080/s3810.m4s",
                profile: { duration: 2 },
                slotId: "slot_3810",
              },
              sequenceNumber: 3810,
            },
            {
              parts: [
                {
                  commitId: "commit_3811_0",
                  deliveryUrl: "/media/v1080/3811.0.m4s",
                  objectKey: "media/v1080/3811.0.m4s",
                  partNumber: 0,
                  profile: { duration: 0.5, independent: true },
                  slotId: "slot_3811_0",
                },
                {
                  commitId: "commit_3811_1",
                  deliveryUrl: "/media/v1080/3811.1.m4s",
                  objectKey: "media/v1080/3811.1.m4s",
                  partNumber: 1,
                  profile: { duration: 0.5, independent: false },
                  slotId: "slot_3811_1",
                },
              ],
              sequenceNumber: 3811,
            },
          ],
          trackId: "v1080",
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
          sequenceNumber: 3811,
        },
      ],
      epoch: 1,
      initCommits: [initCommit],
      maxSegments: 1,
      sessionId: "session_1",
    });

    expect(window.firstSequenceNumber).toBe(3811);
    expect(window.lastSequenceNumber).toBe(3811);
    expect(window.tracks.v1080?.segments).toHaveLength(1);
    // Commits carry no discontinuity markers, so trimming accrues no track
    // window profile.
    expect(window.tracks.v1080?.profile).toBeUndefined();
  });

  test("rejects invalid committed window segment limits", () => {
    expect(() =>
      createCommittedWindow({
        commits: [segmentCommit],
        epoch: 1,
        initCommits: [initCommit],
        maxSegments: 0,
        sessionId: "session_1",
      })
    ).toThrow("maxSegments must be a positive integer");
  });

  test("does not advance the window through a missing part", () => {
    const window = createCommittedWindow({
      commits: [segmentCommit, partCommit(1)],
      epoch: 1,
      initCommits: [initCommit],
      sessionId: "session_1",
    });

    expect(window.lastSequenceNumber).toBe(3810);
    expect(window.tracks.v1080?.segments).toEqual([
      {
        segment: {
          commitId: "commit_3810",
          deliveryUrl: "/media/v1080/s3810.m4s",
          objectKey: "media/v1080/s3810.m4s",
          profile: { duration: 2 },
          slotId: "slot_3810",
        },
        sequenceNumber: 3810,
      },
    ]);
  });

  test("derives media sequence range from part-only segments", () => {
    const window = createCommittedWindow({
      commits: [partCommit(0)],
      epoch: 1,
      initCommits: [initCommit],
      sessionId: "session_1",
    });

    expect(window.firstSequenceNumber).toBe(3811);
    expect(window.lastSequenceNumber).toBe(3811);
    expect(window.tracks.v1080?.segments).toEqual([
      {
        parts: [
          {
            commitId: "commit_3811_0",
            deliveryUrl: "/media/v1080/3811.0.m4s",
            objectKey: "media/v1080/3811.0.m4s",
            partNumber: 0,
            profile: { duration: 0.5, independent: true },
            slotId: "slot_3811_0",
          },
        ],
        sequenceNumber: 3811,
      },
    ]);
  });

  test("keeps only the contiguous prefix of committed parts", () => {
    const window = createCommittedWindow({
      commits: [partCommit(0), partCommit(2)],
      epoch: 1,
      initCommits: [initCommit],
      sessionId: "session_1",
    });

    expect(window.tracks.v1080?.segments).toEqual([
      {
        parts: [
          {
            commitId: "commit_3811_0",
            deliveryUrl: "/media/v1080/3811.0.m4s",
            objectKey: "media/v1080/3811.0.m4s",
            partNumber: 0,
            profile: { duration: 0.5, independent: true },
            slotId: "slot_3811_0",
          },
        ],
        sequenceNumber: 3811,
      },
    ]);
  });

  test("builds tracks without init objects when no init commits exist", () => {
    const window = createCommittedWindow({
      commits: [segmentCommit],
      epoch: 1,
      initCommits: [],
      sessionId: "session_1",
    });

    expect(window.tracks.v1080?.init).toBeUndefined();
    expect(window.tracks.v1080?.segments).toHaveLength(1);
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

  test("accepts commits for tracks without an init commit", () => {
    const window = createCommittedWindow({
      commits: [{ ...segmentCommit, trackId: "v720" }],
      epoch: 1,
      initCommits: [initCommit],
      sessionId: "session_1",
    });

    expect(window.tracks.v720?.init).toBeUndefined();
    expect(window.tracks.v720?.segments).toHaveLength(1);
  });

  test("rejects duplicate init commits for one track", () => {
    expect(() =>
      createCommittedWindow({
        commits: [segmentCommit],
        epoch: 1,
        initCommits: [
          initCommit,
          {
            ...initCommit,
            commitId: "commit_init_retry",
            slotId: "slot_init_retry",
          },
        ],
        sessionId: "session_1",
      })
    ).toThrow("initCommits must not contain duplicate track IDs");
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

  test("tryCreateCommittedWindow returns undefined when only non-contiguous parts have landed", () => {
    expect(
      tryCreateCommittedWindow({
        commits: [partCommit(3)],
        epoch: 1,
        initCommits: [initCommit],
        sessionId: "session_1",
      })
    ).toBeUndefined();
  });

  test("omits tracks whose only commits are out-of-order parts", () => {
    const audioInitCommit: Commit = {
      ...initCommit,
      commitId: "commit_init_a128",
      deliveryUrl: "/media/a128/init.mp4",
      objectKey: "media/a128/init.mp4",
      slotId: "slot_init_a128",
      trackId: "a128",
    };
    const audioPartCommit: Commit = {
      ...partCommit(1),
      commitId: "commit_a128_3811_1",
      deliveryUrl: "/media/a128/3811.1.m4s",
      objectKey: "media/a128/3811.1.m4s",
      slotId: "slot_a128_3811_1",
      trackId: "a128",
    };

    const window = createCommittedWindow({
      commits: [segmentCommit, audioPartCommit],
      epoch: 1,
      initCommits: [initCommit, audioInitCommit],
      sessionId: "session_1",
    });

    // Audio's only commit is part 1 without part 0 — no contiguous prefix
    // yet, so the track is omitted instead of failing window validation,
    // and the window-global range comes from the present tracks alone.
    expect(Object.keys(window.tracks)).toEqual(["v1080"]);
    expect(window.firstSequenceNumber).toBe(3810);
    expect(window.lastSequenceNumber).toBe(3810);
  });

  test("createCommittedWindow still throws when no contiguous prefix exists", () => {
    expect(() =>
      createCommittedWindow({
        commits: [partCommit(3)],
        epoch: 1,
        initCommits: [initCommit],
        sessionId: "session_1",
      })
    ).toThrow("commits must produce at least one segment");
  });

  test("lastVisiblePartNumber returns the highest contiguous part on the last segment", () => {
    const window = createCommittedWindow({
      commits: [segmentCommit, partCommit(0), partCommit(1)],
      epoch: 1,
      initCommits: [initCommit],
      sessionId: "session_1",
    });

    expect(lastVisiblePartNumber(window)).toBe(1);
  });

  test("lastVisiblePartNumber ignores out-of-order parts that aren't yet contiguous", () => {
    // Segment 3810 is visible; segment 3811 has part 3 but not parts 0-2.
    // The contiguous-prefix rule drops 3811 from the window, so the last
    // visible segment is 3810 (no parts) — partNumber must be undefined.
    const window = createCommittedWindow({
      commits: [segmentCommit, partCommit(3)],
      epoch: 1,
      initCommits: [initCommit],
      sessionId: "session_1",
    });

    expect(window.lastSequenceNumber).toBe(3810);
    expect(lastVisiblePartNumber(window)).toBeUndefined();
  });

  test("copies commit profiles onto parts-only segments", () => {
    const window = createCommittedWindow({
      commits: [partCommit(0), partCommit(1)],
      epoch: 1,
      initCommits: [initCommit],
      sessionId: "session_1",
    });

    expect(
      window.tracks.v1080?.segments[0]?.parts?.map((part) => part.profile)
    ).toEqual([
      { duration: 0.5, independent: true },
      { duration: 0.5, independent: false },
    ]);
    expect(window.tracks.v1080?.segments[0]?.segment).toBeUndefined();
    expect(lastVisiblePartNumber(window)).toBe(1);
  });

  test("keeps the full-segment commit profile when parts are also committed", () => {
    const fullSegmentCommit: Commit = {
      ...segmentCommit,
      commitId: "commit_3811",
      deliveryUrl: "/media/v1080/s3811.m4s",
      objectKey: "media/v1080/s3811.m4s",
      profile: { duration: 2 },
      sequenceNumber: 3811,
      slotId: "slot_3811",
    };

    const window = createCommittedWindow({
      commits: [fullSegmentCommit, partCommit(0), partCommit(1)],
      epoch: 1,
      initCommits: [initCommit],
      sessionId: "session_1",
    });

    expect(window.tracks.v1080?.segments).toEqual([
      expect.objectContaining({
        segment: expect.objectContaining({ profile: { duration: 2 } }),
        sequenceNumber: 3811,
      }),
    ]);
  });

  test("trackWindowBounds tracks a lagging track's own live edge", () => {
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
      deliveryUrl: "/media/a128/s3810.m4s",
      objectKey: "media/a128/s3810.m4s",
      slotId: "slot_a128_3810",
      trackId: "a128",
    };

    const window = createCommittedWindow({
      commits: [
        segmentCommit,
        partCommit(0),
        partCommit(1),
        audioSegmentCommit,
      ],
      epoch: 1,
      initCommits: [initCommit, audioInitCommit],
      sessionId: "session_1",
    });

    // The lagging audio track's live edge is its own last segment, not
    // the window-global last media sequence number.
    expect(window.lastSequenceNumber).toBe(3811);
    expect(trackWindowBounds(window, "a128")).toEqual({
      lastSequenceNumber: 3810,
    });
    expect(trackWindowBounds(window, "v1080")).toEqual({
      lastPartNumber: 1,
      lastSequenceNumber: 3811,
    });
  });

  test("trackWindowBounds omits lastPartNumber for full-segment tails", () => {
    const partsWindow = createCommittedWindow({
      commits: [segmentCommit, partCommit(0)],
      epoch: 1,
      initCommits: [initCommit],
      sessionId: "session_1",
    });
    const fullSegmentWindow = createCommittedWindow({
      commits: [segmentCommit],
      epoch: 1,
      initCommits: [initCommit],
      sessionId: "session_1",
    });

    expect(trackWindowBounds(partsWindow, "v1080")).toEqual({
      lastPartNumber: 0,
      lastSequenceNumber: 3811,
    });
    expect(trackWindowBounds(fullSegmentWindow, "v1080")).toEqual({
      lastSequenceNumber: 3810,
    });
    expect(
      trackWindowBounds(fullSegmentWindow, "v1080")?.lastPartNumber
    ).toBeUndefined();
  });

  test("trackWindowBounds returns undefined for unknown tracks", () => {
    const window = createCommittedWindow({
      commits: [segmentCommit],
      epoch: 1,
      initCommits: [initCommit],
      sessionId: "session_1",
    });

    expect(trackWindowBounds(window, "v720")).toBeUndefined();
  });

  test("rejects duplicate part commits", () => {
    expect(() =>
      createCommittedWindow({
        commits: [partCommit(0), partCommit(0)],
        epoch: 1,
        initCommits: [initCommit],
        sessionId: "session_1",
      })
    ).toThrow("commits must not contain duplicate part positions");
  });
});
