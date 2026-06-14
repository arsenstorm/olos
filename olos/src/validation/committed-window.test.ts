import { describe, expect, test } from "bun:test";

import type {
  CommittedPart,
  CommittedSegment,
  CommittedWindow,
  RenditionWindow,
} from "../types/committed-window";
import { assertCommittedWindow, isCommittedWindow } from "./committed-window";

const validWindow: CommittedWindow = {
  discontinuitySequence: 0,
  epoch: 1,
  firstMediaSequenceNumber: 3810,
  lastMediaSequenceNumber: 3812,
  renditions: {
    v1080: {
      init: {
        commitId: "commit_init",
        deliveryUrl:
          "https://media.example.com/media/tenant/sess/e1/v1080/init.mp4",
        objectKey: "media/tenant/sess/e1/v1080/init.mp4",
        slotId: "slot_init",
      },
      renditionId: "v1080",
      segments: [
        {
          duration: 2,
          mediaSequenceNumber: 3810,
          segment: {
            commitId: "commit_3810",
            deliveryUrl:
              "https://media.example.com/media/tenant/sess/e1/v1080/s3810.m4s",
            objectKey: "media/tenant/sess/e1/v1080/s3810.m4s",
            slotId: "slot_3810",
          },
        },
        {
          duration: 2,
          mediaSequenceNumber: 3811,
          segment: {
            commitId: "commit_3811",
            deliveryUrl:
              "https://media.example.com/media/tenant/sess/e1/v1080/s3811.m4s",
            objectKey: "media/tenant/sess/e1/v1080/s3811.m4s",
            slotId: "slot_3811",
          },
        },
        {
          duration: 2,
          mediaSequenceNumber: 3812,
          parts: [
            {
              commitId: "commit_3812_0",
              deliveryUrl:
                "https://media.example.com/media/tenant/sess/e1/v1080/s3812/p0.m4s",
              duration: 0.5,
              independent: true,
              objectKey: "media/tenant/sess/e1/v1080/s3812/p0.m4s",
              partNumber: 0,
              slotId: "slot_3812_0",
            },
            {
              commitId: "commit_3812_1",
              deliveryUrl:
                "https://media.example.com/media/tenant/sess/e1/v1080/s3812/p1.m4s",
              duration: 0.5,
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

function validRendition(): RenditionWindow {
  const rendition = validWindow.renditions.v1080;

  if (!rendition) {
    throw new Error("missing v1080 test fixture");
  }

  return rendition;
}

function validSegment(index: number): CommittedSegment {
  const segment = validRendition().segments[index];

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
        renditions: {
          v1080: {
            ...validRendition(),
            init: {
              ...validRendition().init,
              deliveryUrl: "",
            },
          },
        },
      })
    ).toThrow(
      "committedWindow.renditions.v1080.init.deliveryUrl must be a non-empty string"
    );
  });

  test("rejects unsafe delivery URLs", () => {
    const firstSegment = validSegment(0);
    const liveSegment = validSegment(2);
    const firstPart = validPart(0);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        renditions: {
          v1080: {
            ...validRendition(),
            init: {
              ...validRendition().init,
              deliveryUrl: "media/init.mp4",
            },
          },
        },
      })
    ).toThrow(
      "committedWindow.renditions.v1080.init.deliveryUrl must be an absolute HTTP(S) URL or safe relative path"
    );

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        renditions: {
          v1080: {
            ...validRendition(),
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
      "committedWindow.renditions.v1080.segments[].segment.deliveryUrl must not contain query strings or fragments"
    );

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        renditions: {
          v1080: {
            ...validRendition(),
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
      "committedWindow.renditions.v1080.segments[].parts[].deliveryUrl must not contain control characters"
    );
  });

  test("rejects unsafe object keys", () => {
    const firstSegment = validSegment(0);
    const liveSegment = validSegment(2);
    const firstPart = validPart(0);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        renditions: {
          v1080: {
            ...validRendition(),
            init: {
              ...validRendition().init,
              objectKey: "/media/init.mp4",
            },
          },
        },
      })
    ).toThrow(
      "committedWindow.renditions.v1080.init.objectKey must be a safe relative object key"
    );

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        renditions: {
          v1080: {
            ...validRendition(),
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
      "committedWindow.renditions.v1080.segments[].segment.objectKey must be a safe relative object key"
    );

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        renditions: {
          v1080: {
            ...validRendition(),
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
      "committedWindow.renditions.v1080.segments[].parts[].objectKey must not contain query strings or fragments"
    );
  });

  test("rejects empty optional committed object strings", () => {
    const firstSegment = validSegment(0);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        renditions: {
          v1080: {
            ...validRendition(),
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
      "committedWindow.renditions.v1080.segments[].segment.contentType must be a non-empty string"
    );

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        renditions: {
          v1080: {
            ...validRendition(),
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
      "committedWindow.renditions.v1080.segments[].segment.etag must be a non-empty string"
    );
  });

  test("rejects non-monotonic media sequences", () => {
    const firstSegment = validSegment(0);
    const secondSegment = validSegment(1);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        renditions: {
          v1080: {
            ...validRendition(),
            segments: [secondSegment, firstSegment],
          },
        },
      })
    ).toThrow(
      "committedWindow.renditions.v1080.segments must have monotonic media sequences"
    );
  });

  test("rejects duplicate segment positions", () => {
    const firstSegment = validSegment(0);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        renditions: {
          v1080: {
            ...validRendition(),
            segments: [firstSegment, firstSegment],
          },
        },
      })
    ).toThrow(
      "committedWindow.renditions.v1080.segments must not contain duplicate positions"
    );
  });

  test("rejects non-monotonic part numbers", () => {
    const liveSegment = validSegment(2);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        renditions: {
          v1080: {
            ...validRendition(),
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
      "committedWindow.renditions.v1080.segments[].parts must have monotonic part numbers"
    );
  });

  test("rejects duplicate part positions with different URLs", () => {
    const liveSegment = validSegment(2);
    const firstPart = validPart(0);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        renditions: {
          v1080: {
            ...validRendition(),
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
      "committedWindow.renditions.v1080.segments[].parts must not contain duplicate positions with different URLs"
    );
  });

  test("rejects missing segment duration", () => {
    const firstSegment = validSegment(0);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        renditions: {
          v1080: {
            ...validRendition(),
            segments: [{ ...firstSegment, duration: 0 }],
          },
        },
      })
    ).toThrow(
      "committedWindow.renditions.v1080.segments[].duration must be a positive number"
    );
  });

  test("rejects invalid program date-times", () => {
    const firstSegment = validSegment(0);
    const liveSegment = validSegment(2);
    const firstPart = validPart(0);

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        renditions: {
          v1080: {
            ...validRendition(),
            segments: [{ ...firstSegment, programDateTime: "soon" }],
          },
        },
      })
    ).toThrow(
      "committedWindow.renditions.v1080.segments[].programDateTime must be a valid timestamp"
    );

    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        renditions: {
          v1080: {
            ...validRendition(),
            segments: [
              {
                ...liveSegment,
                parts: [{ ...firstPart, programDateTime: "soon" }],
              },
            ],
          },
        },
      })
    ).toThrow(
      "committedWindow.renditions.v1080.segments[].parts[].programDateTime must be a valid timestamp"
    );
  });

  test("rejects unrenderable segments", () => {
    expect(() =>
      assertCommittedWindow({
        ...validWindow,
        renditions: {
          v1080: {
            ...validRendition(),
            segments: [
              {
                duration: 2,
                mediaSequenceNumber: 3810,
              },
            ],
          },
        },
      })
    ).toThrow(
      "committedWindow.renditions.v1080.segments[] must contain a segment or parts"
    );
  });
});
