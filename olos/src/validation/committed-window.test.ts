import { describe, expect, test } from "bun:test";

import type {
  CommittedPart,
  CommittedSegment,
  CommittedWindow,
  TrackWindow,
} from "../types/committed-window";
import { assertCommittedWindow, isCommittedWindow } from "./committed-window";

const validWindow: CommittedWindow = {
  epoch: 1,
  firstSequenceNumber: 3810,
  lastSequenceNumber: 3812,
  tracks: {
    v1080: {
      init: {
        commitId: "commit_init",
        deliveryUrl:
          "https://media.example.com/media/tenant/sess/e1/v1080/init.mp4",
        objectKey: "media/tenant/sess/e1/v1080/init.mp4",
        slotId: "slot_init",
      },
      trackId: "v1080",
      segments: [
        {
          sequenceNumber: 3810,
          segment: {
            commitId: "commit_3810",
            deliveryUrl:
              "https://media.example.com/media/tenant/sess/e1/v1080/s3810.m4s",
            objectKey: "media/tenant/sess/e1/v1080/s3810.m4s",
            slotId: "slot_3810",
            profile: { duration: 2 },
          },
        },
        {
          sequenceNumber: 3811,
          segment: {
            commitId: "commit_3811",
            deliveryUrl:
              "https://media.example.com/media/tenant/sess/e1/v1080/s3811.m4s",
            objectKey: "media/tenant/sess/e1/v1080/s3811.m4s",
            slotId: "slot_3811",
            profile: { duration: 2 },
          },
        },
        {
          sequenceNumber: 3812,
          parts: [
            {
              commitId: "commit_3812_0",
              deliveryUrl:
                "https://media.example.com/media/tenant/sess/e1/v1080/s3812/p0.m4s",
              profile: { duration: 0.5, independent: true },
              objectKey: "media/tenant/sess/e1/v1080/s3812/p0.m4s",
              partNumber: 0,
              slotId: "slot_3812_0",
            },
            {
              commitId: "commit_3812_1",
              deliveryUrl:
                "https://media.example.com/media/tenant/sess/e1/v1080/s3812/p1.m4s",
              profile: { duration: 0.5 },
              objectKey: "media/tenant/sess/e1/v1080/s3812/p1.m4s",
              partNumber: 1,
              slotId: "slot_3812_1",
            },
          ],
        },
      ],
    },
  },
};

function validTrack(): TrackWindow {
  const track = validWindow.tracks.v1080;

  if (!track) {
    throw new Error("missing v1080 test fixture");
  }

  return track;
}

function validSegment(index: number): CommittedSegment {
  const segment = validTrack().segments[index];

  if (!segment) {
    throw new Error(`missing segment test fixture at index ${index}`);
  }

  return segment;
}

function validPart(index: number): CommittedPart {
  const part = validSegment(2).parts?.[index];

  if (!part) {
    throw new Error(`missing part test fixture at index ${index}`);
  }

  return part;
}

describe("committed window validation", () => {
  test("accepts a valid committed window", () => {
    expect(isCommittedWindow(validWindow)).toBe(true);
    expect(() => assertCommittedWindow(validWindow)).not.toThrow();
  });

  test("accepts an optional track window profile", () => {
    expect(
      isCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: { ...validTrack(), profile: { discontinuitySequence: 2 } },
        },
      })
    ).toBe(true);
  });

  test("rejects non-object track window profiles", () => {
    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: { ...validTrack(), profile: 2 },
        },
      })
    ).toThrow("committedWindow.tracks.v1080.profile must be an object");
  });

  test("rejects non-object values", () => {
    expect(isCommittedWindow(null)).toBe(false);
    expect(() => assertCommittedWindow(null)).toThrow(
      "committedWindow must be an object"
    );
  });

  test("rejects missing init delivery URLs", () => {
    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            init: {
              ...validTrack().init,
              deliveryUrl: "",
            },
          },
        },
      })
    ).toThrow(
      "committedWindow.tracks.v1080.init.deliveryUrl must be a non-empty string"
    );
  });

  test("rejects unsafe delivery URLs", () => {
    const firstSegment = validSegment(0);
    const liveSegment = validSegment(2);
    const firstPart = validPart(0);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            init: {
              ...validTrack().init,
              deliveryUrl: "media/v1080/init.mp4",
            },
          },
        },
      })
    ).toThrow(
      "committedWindow.tracks.v1080.init.deliveryUrl must be an absolute HTTP(S) URL or safe relative path"
    );

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [
              {
                ...firstSegment,
                segment: {
                  ...firstSegment.segment,
                  deliveryUrl:
                    "https://media.example.com/media/v1080/s3810.m4s?token=abc",
                },
              },
            ],
          },
        },
      })
    ).toThrow(
      "committedWindow.tracks.v1080.segments[].segment.deliveryUrl must not contain query strings or fragments"
    );

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [
              {
                ...liveSegment,
                parts: [
                  {
                    ...firstPart,
                    deliveryUrl: "/media/v1080/p0.m4s\n#EXT-X-ENDLIST",
                  },
                ],
              },
            ],
          },
        },
      })
    ).toThrow(
      "committedWindow.tracks.v1080.segments[].parts[].deliveryUrl must not contain control characters"
    );
  });

  test("rejects unsafe object keys", () => {
    const firstSegment = validSegment(0);
    const liveSegment = validSegment(2);
    const firstPart = validPart(0);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            init: {
              ...validTrack().init,
              objectKey: "/media/v1080/init.mp4",
            },
          },
        },
      })
    ).toThrow(
      "committedWindow.tracks.v1080.init.objectKey must be a safe relative object key"
    );

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [
              {
                ...firstSegment,
                segment: {
                  ...firstSegment.segment,
                  objectKey: "media/../secret.m4s",
                },
              },
            ],
          },
        },
      })
    ).toThrow(
      "committedWindow.tracks.v1080.segments[].segment.objectKey must be a safe relative object key"
    );

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [
              {
                ...liveSegment,
                parts: [
                  {
                    ...firstPart,
                    objectKey: "media/v1080/p0.m4s?token=abc",
                  },
                ],
              },
            ],
          },
        },
      })
    ).toThrow(
      "committedWindow.tracks.v1080.segments[].parts[].objectKey must not contain query strings or fragments"
    );
  });

  test("rejects empty optional committed object strings", () => {
    const firstSegment = validSegment(0);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [
              {
                ...firstSegment,
                segment: {
                  ...firstSegment.segment,
                  contentType: "",
                },
              },
            ],
          },
        },
      })
    ).toThrow(
      "committedWindow.tracks.v1080.segments[].segment.contentType must be a valid content type"
    );

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [
              {
                ...firstSegment,
                segment: {
                  ...firstSegment.segment,
                  etag: "",
                },
              },
            ],
          },
        },
      })
    ).toThrow(
      "committedWindow.tracks.v1080.segments[].segment.etag must be a non-empty string"
    );
  });

  test("rejects committed object content types that are not a valid MIME type", () => {
    const firstSegment = validSegment(0);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [
              {
                ...firstSegment,
                segment: {
                  ...firstSegment.segment,
                  contentType: "not a mime type",
                },
              },
            ],
          },
        },
      })
    ).toThrow(
      "committedWindow.tracks.v1080.segments[].segment.contentType must be a valid content type"
    );
  });

  test("rejects non-monotonic media sequences", () => {
    const firstSegment = validSegment(0);
    const secondSegment = validSegment(1);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [secondSegment, firstSegment],
          },
        },
      })
    ).toThrow(
      "committedWindow.tracks.v1080.segments must have monotonic sequence numbers"
    );
  });

  test("rejects duplicate segment positions", () => {
    const firstSegment = validSegment(0);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [firstSegment, firstSegment],
          },
        },
      })
    ).toThrow(
      "committedWindow.tracks.v1080.segments must not contain duplicate positions"
    );
  });

  test("rejects duplicate segment positions across distinct segment objects", () => {
    const firstSegment = validSegment(0);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [
              firstSegment,
              {
                ...firstSegment,
                segment: { ...firstSegment.segment, commitId: "commit_retry" },
              },
            ],
          },
        },
      })
    ).toThrow(
      "committedWindow.tracks.v1080.segments must not contain duplicate positions"
    );
  });

  test("accepts monotonic media sequences with gaps", () => {
    const firstSegment = validSegment(0);
    const thirdSegment = validSegment(2);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [firstSegment, thirdSegment],
          },
        },
      })
    ).not.toThrow();
  });

  test("accepts segments that include a full segment and parts", () => {
    const firstSegment = validSegment(0);
    const firstPart = validPart(0);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [
              {
                ...firstSegment,
                parts: [firstPart],
              },
            ],
          },
        },
      })
    ).not.toThrow();
  });

  test("accepts monotonic part numbers with gaps", () => {
    const liveSegment = validSegment(2);
    const firstPart = validPart(0);
    const secondPart = validPart(1);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [
              {
                ...liveSegment,
                parts: [
                  firstPart,
                  {
                    ...secondPart,
                    partNumber: 2,
                  },
                ],
              },
            ],
          },
        },
      })
    ).not.toThrow();
  });

  test("rejects non-monotonic part numbers", () => {
    const liveSegment = validSegment(2);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [
              {
                ...liveSegment,
                parts: [...(liveSegment.parts ?? [])].reverse(),
              },
            ],
          },
        },
      })
    ).toThrow(
      "committedWindow.tracks.v1080.segments[].parts must have monotonic part numbers"
    );
  });

  test("rejects duplicate part positions with different URLs", () => {
    const liveSegment = validSegment(2);
    const firstPart = validPart(0);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [
              {
                ...liveSegment,
                parts: [
                  firstPart,
                  {
                    ...firstPart,
                    deliveryUrl:
                      "https://media.example.com/media/tenant/sess/e1/v1080/s3812/p0-alt.m4s",
                  },
                ],
              },
            ],
          },
        },
      })
    ).toThrow(
      "committedWindow.tracks.v1080.segments[].parts must not contain duplicate positions with different URLs"
    );
  });

  test("rejects duplicate part positions with the same URL", () => {
    const liveSegment = validSegment(2);
    const firstPart = validPart(0);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [
              {
                ...liveSegment,
                parts: [firstPart, firstPart],
              },
            ],
          },
        },
      })
    ).toThrow(
      "committedWindow.tracks.v1080.segments[].parts must not contain duplicate positions"
    );
  });

  test("rejects non-object committed object profiles", () => {
    const firstSegment = validSegment(0);
    const liveSegment = validSegment(2);
    const firstPart = validPart(0);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [
              {
                ...firstSegment,
                segment: { ...firstSegment.segment, profile: "soon" },
              },
            ],
          },
        },
      })
    ).toThrow(
      "committedWindow.tracks.v1080.segments[].segment.profile must be an object"
    );

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [
              {
                ...liveSegment,
                parts: [{ ...firstPart, profile: [] }],
              },
            ],
          },
        },
      })
    ).toThrow(
      "committedWindow.tracks.v1080.segments[].parts[].profile must be an object"
    );
  });

  test("passes committed object profiles through untouched", () => {
    const firstSegment = validSegment(0);

    expect(
      isCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [
              {
                ...firstSegment,
                segment: {
                  ...firstSegment.segment,
                  profile: { anything: { nested: true } },
                },
              },
              validSegment(1),
              validSegment(2),
            ],
          },
        },
      })
    ).toBe(true);
  });

  test("rejects unrenderable segments", () => {
    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [{ sequenceNumber: 3810 }],
          },
        },
      })
    ).toThrow(
      "committedWindow.tracks.v1080.segments[] must contain a segment or parts"
    );
  });
});
