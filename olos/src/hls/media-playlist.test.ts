import { describe, expect, test } from "bun:test";

import type { CommittedWindow } from "../types/committed-window";
import { renderMediaPlaylist } from "./media-playlist";

const committedWindow: CommittedWindow = {
  discontinuitySequence: 0,
  epoch: 1,
  firstMediaSequenceNumber: 3810,
  lastMediaSequenceNumber: 3812,
  renditions: {
    v1080: {
      init: {
        commitId: "commit_init",
        deliveryUrl:
          "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/init-slot_init_v1080.mp4",
        objectKey:
          "media/tenant_acme/sess_01JZLIVE/e1/v1080/init-slot_init_v1080.mp4",
        slotId: "slot_init_v1080",
      },
      renditionId: "v1080",
      segments: [
        {
          duration: 2,
          mediaSequenceNumber: 3810,
          programDateTime: "2026-06-08T12:00:00.000Z",
          segment: {
            commitId: "commit_3810",
            deliveryUrl:
              "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3810/segment-slot_s3810.m4s",
            objectKey:
              "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3810/segment-slot_s3810.m4s",
            slotId: "slot_s3810",
          },
        },
        {
          duration: 2,
          mediaSequenceNumber: 3811,
          programDateTime: "2026-06-08T12:00:02.000Z",
          segment: {
            commitId: "commit_3811",
            deliveryUrl:
              "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3811/segment-slot_s3811.m4s",
            objectKey:
              "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3811/segment-slot_s3811.m4s",
            slotId: "slot_s3811",
          },
        },
        {
          duration: 2,
          mediaSequenceNumber: 3812,
          programDateTime: "2026-06-08T12:00:04.000Z",
          parts: [
            {
              commitId: "commit_3812_0",
              deliveryUrl:
                "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p0-slot_3812_0.m4s",
              duration: 0.5,
              independent: true,
              objectKey:
                "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p0-slot_3812_0.m4s",
              partNumber: 0,
              slotId: "slot_3812_0",
            },
            {
              commitId: "commit_3812_1",
              deliveryUrl:
                "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p1-slot_3812_1.m4s",
              duration: 0.5,
              objectKey:
                "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p1-slot_3812_1.m4s",
              partNumber: 1,
              slotId: "slot_3812_1",
            },
          ],
        },
      ],
    },
  },
};

function validRendition() {
  const rendition = committedWindow.renditions.v1080;

  if (!rendition) {
    throw new Error("missing v1080 test fixture");
  }

  return rendition;
}

describe("media playlist rendering", () => {
  test("renders deterministic LL-HLS from a committed window", () => {
    expect(
      renderMediaPlaylist(committedWindow, {
        allowedMediaOrigins: ["https://media.example.com"],
        partTarget: 0.5,
        renditionId: "v1080",
        segmentTarget: 2,
      })
    ).toBe(`#EXTM3U
#EXT-X-VERSION:10
#EXT-X-TARGETDURATION:2
#EXT-X-PART-INF:PART-TARGET=0.500
#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=3.000,HOLD-BACK=3.000
#EXT-X-MEDIA-SEQUENCE:3810
#EXT-X-DISCONTINUITY-SEQUENCE:0
#EXT-X-MAP:URI="https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/init-slot_init_v1080.mp4"

#EXT-X-PROGRAM-DATE-TIME:2026-06-08T12:00:00.000Z
#EXTINF:2.000,
https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3810/segment-slot_s3810.m4s
#EXT-X-PROGRAM-DATE-TIME:2026-06-08T12:00:02.000Z
#EXTINF:2.000,
https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3811/segment-slot_s3811.m4s
#EXT-X-PROGRAM-DATE-TIME:2026-06-08T12:00:04.000Z
#EXT-X-PART:DURATION=0.500,INDEPENDENT=YES,URI="https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p0-slot_3812_0.m4s"
#EXT-X-PART:DURATION=0.500,URI="https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p1-slot_3812_1.m4s"
`);
  });

  test("throws for unknown renditions", () => {
    expect(() =>
      renderMediaPlaylist(committedWindow, {
        allowedMediaOrigins: ["https://media.example.com"],
        partTarget: 0.5,
        renditionId: "missing",
        segmentTarget: 2,
      })
    ).toThrow("rendition not found: missing");
  });

  test("supports explicit hold-back values", () => {
    expect(
      renderMediaPlaylist(committedWindow, {
        allowedMediaOrigins: ["https://media.example.com"],
        partHoldBack: 2,
        partTarget: 0.5,
        renditionId: "v1080",
        segmentTarget: 2,
        targetLatency: 4,
      })
    ).toContain("PART-HOLD-BACK=2.000,HOLD-BACK=4.000");
  });

  test("rejects unrealistic part hold-back values", () => {
    expect(() =>
      renderMediaPlaylist(committedWindow, {
        allowedMediaOrigins: ["https://media.example.com"],
        partHoldBack: 1,
        partTarget: 0.5,
        renditionId: "v1080",
        segmentTarget: 2,
      })
    ).toThrow(
      "options.partHoldBack must be at least three times options.partTarget"
    );
  });

  test("rejects invalid explicit hold-back values", () => {
    expect(() =>
      renderMediaPlaylist(committedWindow, {
        allowedMediaOrigins: ["https://media.example.com"],
        partHoldBack: 0,
        partTarget: 0.5,
        renditionId: "v1080",
        segmentTarget: 2,
      })
    ).toThrow("options.partHoldBack must be a positive number");

    expect(() =>
      renderMediaPlaylist(committedWindow, {
        allowedMediaOrigins: ["https://media.example.com"],
        partTarget: 0.5,
        renditionId: "v1080",
        segmentTarget: 2,
        targetLatency: 0,
      })
    ).toThrow("options.targetLatency must be a positive number");
  });

  test("omits preload hints by default", () => {
    expect(
      renderMediaPlaylist(committedWindow, {
        allowedMediaOrigins: ["https://media.example.com"],
        partTarget: 0.5,
        renditionId: "v1080",
        segmentTarget: 2,
      })
    ).not.toContain("#EXT-X-PRELOAD-HINT");
  });

  test("does not emit content steering", () => {
    expect(
      renderMediaPlaylist(committedWindow, {
        allowedMediaOrigins: ["https://media.example.com"],
        partTarget: 0.5,
        renditionId: "v1080",
        segmentTarget: 2,
      })
    ).not.toContain("#EXT-X-CONTENT-STEERING");
  });

  test("refuses non-monotonic committed windows", () => {
    expect(() =>
      renderMediaPlaylist(
        {
          ...committedWindow,
          renditions: {
            v1080: {
              ...validRendition(),
              segments: [...validRendition().segments].reverse(),
            },
          },
        },
        {
          allowedMediaOrigins: ["https://media.example.com"],
          partTarget: 0.5,
          renditionId: "v1080",
          segmentTarget: 2,
        }
      )
    ).toThrow(
      "committedWindow.renditions.v1080.segments must have monotonic media sequences"
    );
  });

  test("renders discontinuities before flagged segments", () => {
    const playlist = renderMediaPlaylist(
      {
        ...committedWindow,
        discontinuitySequence: 1,
        renditions: {
          v1080: {
            ...validRendition(),
            segments: validRendition().segments.map((segment) =>
              segment.mediaSequenceNumber === 3811
                ? { ...segment, discontinuityBefore: true }
                : segment
            ),
          },
        },
      },
      {
        allowedMediaOrigins: ["https://media.example.com"],
        partTarget: 0.5,
        renditionId: "v1080",
        segmentTarget: 2,
      }
    );

    expect(playlist).toContain(`#EXT-X-DISCONTINUITY-SEQUENCE:1
#EXT-X-MAP:URI=`);
    expect(playlist).toContain(`#EXT-X-DISCONTINUITY
#EXT-X-PROGRAM-DATE-TIME:2026-06-08T12:00:02.000Z
#EXTINF:2.000,
https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3811/segment-slot_s3811.m4s`);
  });

  test("rejects absolute media URLs without an allowed origin", () => {
    expect(() =>
      renderMediaPlaylist(committedWindow, {
        partTarget: 0.5,
        renditionId: "v1080",
        segmentTarget: 2,
      })
    ).toThrow("rendition.init.deliveryUrl origin is not allowed");
  });

  test("rejects unsafe media URL schemes", () => {
    expect(() =>
      renderMediaPlaylist(
        {
          ...committedWindow,
          renditions: {
            v1080: {
              ...validRendition(),
              init: {
                ...validRendition().init,
                deliveryUrl: "javascript:alert(1)",
              },
            },
          },
        },
        {
          allowedMediaOrigins: ["https://media.example.com"],
          partTarget: 0.5,
          renditionId: "v1080",
          segmentTarget: 2,
        }
      )
    ).toThrow(
      "committedWindow.renditions.v1080.init.deliveryUrl must be an absolute HTTP(S) URL or safe relative path"
    );
  });

  test("rejects protocol-relative media URLs", () => {
    expect(() =>
      renderMediaPlaylist(
        {
          ...committedWindow,
          renditions: {
            v1080: {
              ...validRendition(),
              init: {
                ...validRendition().init,
                deliveryUrl: "//media.example.com/init.mp4",
              },
            },
          },
        },
        {
          allowedMediaOrigins: ["https://media.example.com"],
          partTarget: 0.5,
          renditionId: "v1080",
          segmentTarget: 2,
        }
      )
    ).toThrow(
      "committedWindow.renditions.v1080.init.deliveryUrl must be an absolute HTTP(S) URL or safe relative path"
    );
  });

  test("rejects relative media URLs with query strings or fragments", () => {
    expect(() =>
      renderMediaPlaylist(
        {
          ...committedWindow,
          renditions: {
            v1080: {
              ...validRendition(),
              init: {
                ...validRendition().init,
                deliveryUrl: "/media/init.mp4?token=abc",
              },
            },
          },
        },
        {
          partTarget: 0.5,
          renditionId: "v1080",
          segmentTarget: 2,
        }
      )
    ).toThrow(
      "committedWindow.renditions.v1080.init.deliveryUrl must not contain query strings or fragments"
    );
  });

  test("rejects media URLs with control characters", () => {
    expect(() =>
      renderMediaPlaylist(
        {
          ...committedWindow,
          renditions: {
            v1080: {
              ...validRendition(),
              init: {
                ...validRendition().init,
                deliveryUrl: "/media/init.mp4\n#EXT-X-ENDLIST",
              },
            },
          },
        },
        {
          partTarget: 0.5,
          renditionId: "v1080",
          segmentTarget: 2,
        }
      )
    ).toThrow(
      "committedWindow.renditions.v1080.init.deliveryUrl must not contain control characters"
    );
  });
});
