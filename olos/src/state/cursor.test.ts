import { describe, expect, test } from "bun:test";
import type { CommittedWindow } from "../types/committed-window";
import { createCursor, resolveCursorUpdate } from "./cursor";

const committedWindow: CommittedWindow = {
  epoch: 7,
  firstSequenceNumber: 3810,
  lastSequenceNumber: 3811,
  tracks: {
    v1080: {
      init: {
        commitId: "commit_init",
        deliveryUrl: "/media/v1080/init.mp4",
        objectKey: "tenant/session/v1080/init.mp4",
        slotId: "slot_init",
      },
      segments: [
        {
          segment: {
            commitId: "commit_3810",
            deliveryUrl: "/media/3810.m4s",
            objectKey: "tenant/session/v1080/3810.m4s",
            profile: { duration: 1 },
            slotId: "slot_3810",
          },
          sequenceNumber: 3810,
        },
        {
          parts: [
            {
              commitId: "commit_3811_0",
              deliveryUrl: "/media/3811.0.m4s",
              objectKey: "tenant/session/v1080/3811.0.m4s",
              partNumber: 0,
              profile: { duration: 0.333 },
              slotId: "slot_3811_0",
            },
          ],
          sequenceNumber: 3811,
        },
      ],
      trackId: "v1080",
    },
  },
};

const options = {
  committedWindow,
  deliveryBaseUrl: "https://media.example.com",
  profile: { id: "cmaf-llhls", partTarget: 0.333, segmentTarget: 1 },
  sessionId: "session_1",
  state: "live",
  updatedAt: "2026-06-08T12:00:01.820Z",
} as const;

const v1080 = committedWindow.tracks.v1080;

if (v1080 === undefined) {
  throw new Error("missing v1080 fixture");
}

const firstSegment = v1080.segments[0];

if (firstSegment === undefined) {
  throw new Error("missing first segment fixture");
}

const secondSegment = v1080.segments[1];

if (secondSegment === undefined) {
  throw new Error("missing second segment fixture");
}

const alternateTrack: CommittedWindow["tracks"][string] = {
  init: {
    commitId: "commit_v720_init",
    deliveryUrl: "/media/v720/init.mp4",
    objectKey: "tenant/session/v720/init.mp4",
    slotId: "slot_v720_init",
  },
  segments: [
    {
      segment: {
        commitId: "commit_v720_3810",
        deliveryUrl: "/media/v720/s3810.m4s",
        objectKey: "tenant/session/v720/3810.m4s",
        profile: { duration: 1 },
        slotId: "slot_v720_3810",
      },
      sequenceNumber: 3810,
    },
  ],
  trackId: "v720",
};

describe("cursor builder", () => {
  test("derives a valid cursor from a committed window", () => {
    expect(createCursor(options)).toEqual({
      committedWindow,
      deliveryBaseUrl: "https://media.example.com",
      epoch: 7,
      olos: "1.0",
      profile: { id: "cmaf-llhls", partTarget: 0.333, segmentTarget: 1 },
      sessionId: "session_1",
      state: "live",
      updatedAt: "2026-06-08T12:00:01.820Z",
      window: {
        firstSequenceNumber: 3810,
        lastSequenceNumber: 3811,
      },
    });
  });

  test("includes an explicit last part number", () => {
    expect(createCursor({ ...options, lastPartNumber: 0 }).window).toEqual({
      firstSequenceNumber: 3810,
      lastPartNumber: 0,
      lastSequenceNumber: 3811,
    });
  });

  test("rejects invalid cursor inputs", () => {
    expect(() => createCursor({ ...options, sessionId: "../secret" })).toThrow(
      "cursor.sessionId must be a non-empty URL-safe identifier"
    );
  });
});

describe("cursor update resolution", () => {
  const currentCursor = createCursor(options);

  test("accepts candidates ahead of the current cursor", () => {
    const candidateCursor = createCursor({
      ...options,
      committedWindow: {
        ...committedWindow,
        lastSequenceNumber: 3812,
        tracks: {
          v1080: {
            ...v1080,
            segments: [
              ...v1080.segments,
              {
                segment: {
                  commitId: "commit_3812",
                  deliveryUrl: "/media/3812.m4s",
                  objectKey: "tenant/session/v1080/3812.m4s",
                  profile: { duration: 1 },
                  slotId: "slot_3812",
                },
                sequenceNumber: 3812,
              },
            ],
          },
        },
      },
    });

    expect(
      resolveCursorUpdate({
        candidateCursor,
        currentCursor,
      })
    ).toEqual({
      cursor: candidateCursor,
      status: "advanced",
    });
  });

  test("keeps the current cursor for idempotent updates", () => {
    expect(
      resolveCursorUpdate({
        candidateCursor: {
          ...currentCursor,
          updatedAt: "2026-06-08T12:00:02.820Z",
        },
        currentCursor,
      })
    ).toEqual({
      cursor: currentCursor,
      status: "idempotent",
    });
  });

  test("treats equivalent committed windows as idempotent regardless of track key order", () => {
    const firstWindow: CommittedWindow = {
      ...committedWindow,
      tracks: {
        v720: alternateTrack,
        v1080,
      },
    };
    const secondWindow: CommittedWindow = {
      ...committedWindow,
      tracks: {
        v720: alternateTrack,
        v1080,
      },
    };
    const currentCursor = createCursor({
      ...options,
      committedWindow: firstWindow,
    });
    const candidateCursor = createCursor({
      ...options,
      committedWindow: secondWindow,
      updatedAt: "2026-06-08T12:00:02.820Z",
    });

    expect(
      resolveCursorUpdate({
        candidateCursor,
        currentCursor,
      })
    ).toEqual({
      cursor: currentCursor,
      status: "idempotent",
    });
  });

  test("accepts same-position candidates with expanded committed windows", () => {
    const candidateCursor = createCursor({
      ...options,
      committedWindow: {
        ...committedWindow,
        tracks: {
          ...committedWindow.tracks,
          v720: alternateTrack,
        },
      },
    });

    expect(
      resolveCursorUpdate({
        candidateCursor,
        currentCursor,
      })
    ).toEqual({
      cursor: candidateCursor,
      status: "advanced",
    });
  });

  test("accepts same-position candidates with changed track IDs", () => {
    const candidateCursor = createCursor({
      ...options,
      committedWindow: {
        ...committedWindow,
        tracks: {
          v720: {
            ...alternateTrack,
            segments: [
              ...alternateTrack.segments,
              {
                segment: {
                  commitId: "commit_v720_3811",
                  deliveryUrl: "/media/v720/3811.m4s",
                  objectKey: "tenant/session/v720/3811.m4s",
                  profile: { duration: 1 },
                  slotId: "slot_v720_3811",
                },
                sequenceNumber: 3811,
              },
            ],
          },
        },
      },
    });

    expect(
      resolveCursorUpdate({
        candidateCursor,
        currentCursor,
      })
    ).toEqual({
      cursor: candidateCursor,
      status: "advanced",
    });
  });

  test("accepts same-position candidates with changed track window profile", () => {
    const track = committedWindow.tracks.v1080;

    if (track === undefined) {
      throw new Error("fixture track missing");
    }

    const candidateCursor = createCursor({
      ...options,
      committedWindow: {
        ...committedWindow,
        tracks: {
          ...committedWindow.tracks,
          v1080: { ...track, profile: { discontinuitySequence: 1 } },
        },
      },
    });

    expect(
      resolveCursorUpdate({
        candidateCursor,
        currentCursor,
      })
    ).toEqual({
      cursor: candidateCursor,
      status: "advanced",
    });
  });

  test("accepts same-position candidates with changed committed objects", () => {
    const candidateCursor = createCursor({
      ...options,
      committedWindow: {
        ...committedWindow,
        tracks: {
          v1080: {
            ...v1080,
            segments: [
              {
                ...firstSegment,
                segment: {
                  commitId: "commit_3810_retry",
                  deliveryUrl: "/media/3810.m4s",
                  objectKey: "tenant/session/v1080/3810.m4s",
                  slotId: "slot_3810",
                },
              },
              secondSegment,
            ],
          },
        },
      },
    });

    expect(
      resolveCursorUpdate({
        candidateCursor,
        currentCursor,
      })
    ).toEqual({
      cursor: candidateCursor,
      status: "advanced",
    });
  });

  test("accepts same-position candidates with changed committed parts", () => {
    const candidateCursor = createCursor({
      ...options,
      committedWindow: {
        ...committedWindow,
        tracks: {
          v1080: {
            ...v1080,
            segments: [
              firstSegment,
              {
                ...secondSegment,
                parts: [
                  {
                    commitId: "commit_3811_0_retry",
                    deliveryUrl: "/media/3811.0.m4s",
                    objectKey: "tenant/session/v1080/3811.0.m4s",
                    partNumber: 0,
                    profile: { duration: 0.333 },
                    slotId: "slot_3811_0",
                  },
                ],
              },
            ],
          },
        },
      },
    });

    expect(
      resolveCursorUpdate({
        candidateCursor,
        currentCursor,
      })
    ).toEqual({
      cursor: candidateCursor,
      status: "advanced",
    });
  });

  test("accepts same-position candidates with changed part byterange", () => {
    const partWithByterange = {
      byterange: {
        length: 100,
        offset: 0,
        segmentDeliveryUrl: "/media/3811.m4s",
        segmentObjectKey: "tenant/session/v1080/3811.m4s",
      },
      commitId: "commit_3811_0",
      deliveryUrl: "/media/3811.0.m4s",
      objectKey: "tenant/session/v1080/3811.0.m4s",
      partNumber: 0,
      profile: { duration: 0.333 },
      slotId: "slot_3811_0",
    };
    const baseCursor = createCursor({
      ...options,
      committedWindow: {
        ...committedWindow,
        tracks: {
          v1080: {
            ...v1080,
            segments: [
              firstSegment,
              { ...secondSegment, parts: [partWithByterange] },
            ],
          },
        },
      },
    });
    const candidateCursor = createCursor({
      ...options,
      committedWindow: {
        ...committedWindow,
        tracks: {
          v1080: {
            ...v1080,
            segments: [
              firstSegment,
              {
                ...secondSegment,
                parts: [
                  {
                    ...partWithByterange,
                    byterange: { ...partWithByterange.byterange, length: 200 },
                  },
                ],
              },
            ],
          },
        },
      },
    });

    expect(
      resolveCursorUpdate({
        candidateCursor,
        currentCursor: baseCursor,
      })
    ).toEqual({
      cursor: candidateCursor,
      status: "advanced",
    });
  });

  test("rejects candidates behind the current media sequence", () => {
    const candidateCursor = createCursor({
      ...options,
      committedWindow: {
        ...committedWindow,
        firstSequenceNumber: 3810,
        lastSequenceNumber: 3810,
        tracks: {
          v1080: {
            ...v1080,
            segments: [firstSegment],
          },
        },
      },
    });

    expect(
      resolveCursorUpdate({
        candidateCursor,
        currentCursor,
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.cursor_regression",
          details: {
            candidateLastSequenceNumber: 3810,
            currentLastSequenceNumber: 3811,
            sessionId: "session_1",
          },
          message: "candidate cursor is behind the current cursor",
        },
      },
      status: "regression",
    });
  });

  test("rejects candidates behind the current part number", () => {
    // The current cursor's window must actually show part 1 (§3.8), so it
    // extends the fixture's parts tail before claiming lastPartNumber 1.
    const windowWithSecondPart: CommittedWindow = {
      ...committedWindow,
      tracks: {
        v1080: {
          ...v1080,
          segments: [
            firstSegment,
            {
              ...secondSegment,
              parts: [
                ...(secondSegment.parts ?? []),
                {
                  commitId: "commit_3811_1",
                  deliveryUrl: "/media/3811.1.m4s",
                  objectKey: "tenant/session/v1080/3811.1.m4s",
                  partNumber: 1,
                  profile: { duration: 0.333 },
                  slotId: "slot_3811_1",
                },
              ],
            },
          ],
        },
      },
    };
    const currentPartCursor = createCursor({
      ...options,
      committedWindow: windowWithSecondPart,
      lastPartNumber: 1,
    });
    const candidateCursor = createCursor({ ...options, lastPartNumber: 0 });

    expect(
      resolveCursorUpdate({
        candidateCursor,
        currentCursor: currentPartCursor,
      }).status
    ).toBe("regression");
  });
});
