import { describe, expect, test } from "bun:test";
import type { CommittedWindow } from "../types/committed-window";
import { createCursor, resolveCursorUpdate } from "./cursor";

const committedWindow: CommittedWindow = {
  discontinuitySequence: 0,
  epoch: 7,
  firstMediaSequenceNumber: 3810,
  lastMediaSequenceNumber: 3811,
  renditions: {
    v1080: {
      init: {
        commitId: "commit_init",
        deliveryUrl: "/media/init.mp4",
        objectKey: "tenant/session/v1080/init.mp4",
        slotId: "slot_init",
      },
      renditionId: "v1080",
      segments: [
        {
          duration: 1,
          mediaSequenceNumber: 3810,
          segment: {
            commitId: "commit_3810",
            deliveryUrl: "/media/3810.m4s",
            objectKey: "tenant/session/v1080/3810.m4s",
            slotId: "slot_3810",
          },
        },
        {
          duration: 1,
          mediaSequenceNumber: 3811,
          parts: [
            {
              commitId: "commit_3811_0",
              deliveryUrl: "/media/3811.0.m4s",
              duration: 0.333,
              objectKey: "tenant/session/v1080/3811.0.m4s",
              partNumber: 0,
              slotId: "slot_3811_0",
            },
          ],
        },
      ],
    },
  },
};

const options = {
  committedWindow,
  latencyProfile: "object-ll",
  mediaBaseUrl: "https://media.example.com",
  partTarget: 0.333,
  segmentTarget: 1,
  sessionId: "session_1",
  state: "live",
  updatedAt: "2026-06-08T12:00:01.820Z",
} as const;

const v1080 = committedWindow.renditions.v1080;

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

const alternateRendition: CommittedWindow["renditions"][string] = {
  init: {
    commitId: "commit_v720_init",
    deliveryUrl: "/media/v720/init.mp4",
    objectKey: "tenant/session/v720/init.mp4",
    slotId: "slot_v720_init",
  },
  renditionId: "v720",
  segments: [
    {
      duration: 1,
      mediaSequenceNumber: 3810,
      segment: {
        commitId: "commit_v720_3810",
        deliveryUrl: "/media/v720/3810.m4s",
        objectKey: "tenant/session/v720/3810.m4s",
        slotId: "slot_v720_3810",
      },
    },
  ],
};

describe("cursor builder", () => {
  test("derives a valid cursor from a committed window", () => {
    expect(createCursor(options)).toEqual({
      committedWindow,
      epoch: 7,
      latencyProfile: "object-ll",
      olos: "1.0",
      mediaBaseUrl: "https://media.example.com",
      partTarget: 0.333,
      segmentTarget: 1,
      sessionId: "session_1",
      state: "live",
      updatedAt: "2026-06-08T12:00:01.820Z",
      window: {
        firstMediaSequenceNumber: 3810,
        lastMediaSequenceNumber: 3811,
      },
    });
  });

  test("includes an explicit last part number", () => {
    expect(createCursor({ ...options, lastPartNumber: 0 }).window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3811,
      lastPartNumber: 0,
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
        lastMediaSequenceNumber: 3812,
        renditions: {
          v1080: {
            ...v1080,
            segments: [
              ...v1080.segments,
              {
                duration: 1,
                mediaSequenceNumber: 3812,
                segment: {
                  commitId: "commit_3812",
                  deliveryUrl: "/media/3812.m4s",
                  objectKey: "tenant/session/v1080/3812.m4s",
                  slotId: "slot_3812",
                },
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

  test("treats equivalent committed windows as idempotent regardless of rendition key order", () => {
    const firstWindow: CommittedWindow = {
      ...committedWindow,
      renditions: {
        v1080,
        v720: alternateRendition,
      },
    };
    const secondWindow: CommittedWindow = {
      ...committedWindow,
      renditions: {
        v720: alternateRendition,
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
        renditions: {
          ...committedWindow.renditions,
          v720: alternateRendition,
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

  test("accepts same-position candidates with changed rendition IDs", () => {
    const candidateCursor = createCursor({
      ...options,
      committedWindow: {
        ...committedWindow,
        renditions: {
          v720: {
            ...alternateRendition,
            segments: [
              ...alternateRendition.segments,
              {
                duration: 1,
                mediaSequenceNumber: 3811,
                segment: {
                  commitId: "commit_v720_3811",
                  deliveryUrl: "/media/v720/3811.m4s",
                  objectKey: "tenant/session/v720/3811.m4s",
                  slotId: "slot_v720_3811",
                },
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

  test("accepts same-position candidates with changed discontinuity sequence", () => {
    const candidateCursor = createCursor({
      ...options,
      committedWindow: {
        ...committedWindow,
        discontinuitySequence: 1,
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
        renditions: {
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
        renditions: {
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
                    duration: 0.333,
                    objectKey: "tenant/session/v1080/3811.0.m4s",
                    partNumber: 0,
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

  test("rejects candidates behind the current media sequence", () => {
    const candidateCursor = createCursor({
      ...options,
      committedWindow: {
        ...committedWindow,
        firstMediaSequenceNumber: 3810,
        lastMediaSequenceNumber: 3810,
        renditions: {
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
            candidateLastMediaSequenceNumber: 3810,
            currentLastMediaSequenceNumber: 3811,
            sessionId: "session_1",
          },
          message: "candidate cursor is behind the current cursor",
        },
      },
      status: "regression",
    });
  });

  test("rejects candidates behind the current part number", () => {
    const currentPartCursor = createCursor({ ...options, lastPartNumber: 1 });
    const candidateCursor = createCursor({ ...options, lastPartNumber: 0 });

    expect(
      resolveCursorUpdate({
        candidateCursor,
        currentCursor: currentPartCursor,
      }).status
    ).toBe("regression");
  });
});
