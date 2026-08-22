import { describe, expect, test } from "bun:test";

import type {
  CommittedObject,
  CommittedSegment,
  CommittedWindow,
} from "../types/committed-window";
import { renderMediaPlaylist } from "./media-playlist";

const MEDIA_ORIGIN = "https://media.example.com";

const committedWindow: CommittedWindow = {
  epoch: 1,
  firstSequenceNumber: 3810,
  lastSequenceNumber: 3812,
  tracks: {
    v1080: {
      init: {
        commitId: "commit_init",
        deliveryUrl:
          "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/init-slot_init_v1080.mp4",
        objectKey:
          "media/tenant_acme/sess_01JZLIVE/e1/v1080/init-slot_init_v1080.mp4",
        slotId: "slot_init_v1080",
      },
      trackId: "v1080",
      segments: [
        {
          sequenceNumber: 3810,
          segment: {
            commitId: "commit_3810",
            deliveryUrl:
              "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3810-slot_s3810.m4s",
            objectKey:
              "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3810-slot_s3810.m4s",
            profile: {
              duration: 2,
              programDateTime: "2026-06-08T12:00:00.000Z",
            },
            slotId: "slot_s3810",
          },
        },
        {
          sequenceNumber: 3811,
          segment: {
            commitId: "commit_3811",
            deliveryUrl:
              "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3811-slot_s3811.m4s",
            objectKey:
              "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3811-slot_s3811.m4s",
            profile: {
              duration: 2,
              programDateTime: "2026-06-08T12:00:02.000Z",
            },
            slotId: "slot_s3811",
          },
        },
        {
          sequenceNumber: 3812,
          parts: [
            {
              commitId: "commit_3812_0",
              deliveryUrl:
                "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p0-slot_3812_0.m4s",
              objectKey:
                "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p0-slot_3812_0.m4s",
              partNumber: 0,
              profile: {
                duration: 0.5,
                independent: true,
                programDateTime: "2026-06-08T12:00:04.000Z",
              },
              slotId: "slot_3812_0",
            },
            {
              commitId: "commit_3812_1",
              deliveryUrl:
                "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p1-slot_3812_1.m4s",
              objectKey:
                "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p1-slot_3812_1.m4s",
              partNumber: 1,
              profile: { duration: 0.5 },
              slotId: "slot_3812_1",
            },
          ],
        },
      ],
    },
  },
};

const options = {
  allowedDeliveryOrigins: [MEDIA_ORIGIN],
  partTarget: 0.5,
  segmentTarget: 2,
  trackId: "v1080",
};

function validTrack() {
  const track = committedWindow.tracks.v1080;

  if (!track) {
    throw new Error("missing v1080 test fixture");
  }

  return track;
}

function validInit(): CommittedObject {
  const init = validTrack().init;

  if (!init) {
    throw new Error("missing v1080 init fixture");
  }

  return init;
}

function missingSegment(): never {
  throw new Error("missing segment fixture");
}

function withInitDeliveryUrl(deliveryUrl: string): CommittedWindow {
  return {
    ...committedWindow,
    tracks: {
      v1080: {
        ...validTrack(),
        init: { ...validInit(), deliveryUrl },
      },
    },
  };
}

function withoutProgramDateTime(segment: CommittedSegment): CommittedSegment {
  return {
    ...segment,
    ...(segment.segment === undefined
      ? {}
      : {
          segment: {
            ...segment.segment,
            profile: { ...segment.segment.profile, programDateTime: undefined },
          },
        }),
    ...(segment.parts === undefined
      ? {}
      : {
          parts: segment.parts.map((part) => ({
            ...part,
            profile: { ...part.profile, programDateTime: undefined },
          })),
        }),
  };
}

describe("media playlist rendering", () => {
  test("renders deterministic LL-HLS from a committed window", () => {
    expect(renderMediaPlaylist(committedWindow, options)).toBe(`#EXTM3U
#EXT-X-VERSION:10
#EXT-X-TARGETDURATION:2
#EXT-X-PART-INF:PART-TARGET=0.500
#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=3.000,HOLD-BACK=6.000
#EXT-X-MEDIA-SEQUENCE:3810
#EXT-X-DISCONTINUITY-SEQUENCE:0
#EXT-X-MAP:URI="https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/init-slot_init_v1080.mp4"

#EXT-X-PROGRAM-DATE-TIME:2026-06-08T12:00:00.000Z
#EXTINF:2.000,
https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3810-slot_s3810.m4s
#EXT-X-PROGRAM-DATE-TIME:2026-06-08T12:00:02.000Z
#EXTINF:2.000,
https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3811-slot_s3811.m4s
#EXT-X-PROGRAM-DATE-TIME:2026-06-08T12:00:04.000Z
#EXT-X-PART:DURATION=0.500,INDEPENDENT=YES,URI="https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p0-slot_3812_0.m4s"
#EXT-X-PART:DURATION=0.500,URI="https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p1-slot_3812_1.m4s"
`);
  });

  test("declares the rendered track's own first media sequence", () => {
    const trimmedWindow: CommittedWindow = {
      ...committedWindow,
      tracks: {
        v1080: validTrack(),
        v720: {
          ...validTrack(),
          trackId: "v720",
          segments: validTrack().segments.filter(
            (segment) => segment.sequenceNumber >= 3811
          ),
        },
      },
    };

    expect(
      renderMediaPlaylist(trimmedWindow, { ...options, trackId: "v1080" })
    ).toContain("#EXT-X-MEDIA-SEQUENCE:3810");
    expect(
      renderMediaPlaylist(trimmedWindow, { ...options, trackId: "v720" })
    ).toContain("#EXT-X-MEDIA-SEQUENCE:3811");
  });

  test("sums part durations for a full segment without a declared duration", () => {
    const playlist = renderMediaPlaylist(
      {
        ...committedWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: validTrack().segments.map((segment) =>
              segment.sequenceNumber === 3812
                ? {
                    ...segment,
                    segment: {
                      commitId: "commit_3812",
                      deliveryUrl:
                        "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812-slot_s3812.m4s",
                      objectKey:
                        "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812-slot_s3812.m4s",
                      slotId: "slot_s3812",
                    },
                  }
                : segment
            ),
          },
        },
      },
      options
    );

    expect(playlist).toContain(`#EXTINF:1.000,
https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812-slot_s3812.m4s`);
  });

  test("ends the playlist with EXT-X-ENDLIST when the stream has ended", () => {
    const playlist = renderMediaPlaylist(committedWindow, {
      ...options,
      endOfStream: true,
    });

    expect(playlist.endsWith("\n#EXT-X-ENDLIST\n")).toBe(true);
    expect(playlist).not.toContain("#EXT-X-PLAYLIST-TYPE");
  });

  test("omits EXT-X-ENDLIST for live playlists", () => {
    expect(renderMediaPlaylist(committedWindow, options)).not.toContain(
      "#EXT-X-ENDLIST"
    );
    expect(
      renderMediaPlaylist(committedWindow, { ...options, endOfStream: false })
    ).not.toContain("#EXT-X-ENDLIST");
  });

  test("throws for unknown tracks", () => {
    expect(() =>
      renderMediaPlaylist(committedWindow, { ...options, trackId: "missing" })
    ).toThrow("track not found: missing");
  });

  test("throws for tracks without an init object", () => {
    const { init: _init, ...trackWithoutInit } = validTrack();

    expect(() =>
      renderMediaPlaylist(
        { ...committedWindow, tracks: { v1080: trackWithoutInit } },
        options
      )
    ).toThrow("track v1080 has no init object");
  });

  test("supports explicit hold-back values", () => {
    expect(
      renderMediaPlaylist(committedWindow, {
        ...options,
        partHoldBack: 2,
        // Above the three-target-duration floor, so it renders verbatim.
        targetLatency: 8,
      })
    ).toContain("PART-HOLD-BACK=2.000,HOLD-BACK=8.000");
  });

  test("raises HOLD-BACK to three target durations", () => {
    // RFC 8216bis floors HOLD-BACK at 3 × target duration. Apple's player
    // rejects the whole playlist below it, so a lower targetLatency is
    // raised rather than emitted.
    expect(
      renderMediaPlaylist(committedWindow, { ...options, targetLatency: 1.5 })
    ).toContain("HOLD-BACK=6.000");
  });

  test("floors HOLD-BACK on the rounded-up target duration", () => {
    expect(
      renderMediaPlaylist(committedWindow, {
        ...options,
        segmentTarget: 1.2,
        targetLatency: 1.5,
      })
    ).toContain("HOLD-BACK=6.000");
  });

  test("rounds target duration up in media playlist headers", () => {
    expect(
      renderMediaPlaylist(committedWindow, { ...options, segmentTarget: 2.1 })
    ).toContain("#EXT-X-TARGETDURATION:3");
  });

  test("rejects unrealistic part hold-back values", () => {
    expect(() =>
      renderMediaPlaylist(committedWindow, { ...options, partHoldBack: 1 })
    ).toThrow(
      "options.partHoldBack must be at least three times options.partTarget"
    );
  });

  test("rejects invalid explicit hold-back values", () => {
    expect(() =>
      renderMediaPlaylist(committedWindow, { ...options, partHoldBack: 0 })
    ).toThrow("options.partHoldBack must be a positive number");

    expect(() =>
      renderMediaPlaylist(committedWindow, { ...options, targetLatency: 0 })
    ).toThrow("options.targetLatency must be a positive number");
  });

  test("advertises CAN-BLOCK-RELOAD=YES by default", () => {
    expect(renderMediaPlaylist(committedWindow, options)).toContain(
      "#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK="
    );
  });

  test("omits CAN-BLOCK-RELOAD when the server does not block reloads", () => {
    const playlist = renderMediaPlaylist(committedWindow, {
      ...options,
      canBlockReload: false,
    });

    expect(playlist).toContain(
      "#EXT-X-SERVER-CONTROL:PART-HOLD-BACK=3.000,HOLD-BACK=6.000"
    );
    expect(playlist).not.toContain("CAN-BLOCK-RELOAD");
  });

  test("rejects a non-boolean canBlockReload", () => {
    expect(() =>
      renderMediaPlaylist(committedWindow, {
        ...options,
        canBlockReload: "yes" as unknown as boolean,
      })
    ).toThrow("options.canBlockReload must be a boolean");
  });

  test("omits preload hints by default", () => {
    expect(renderMediaPlaylist(committedWindow, options)).not.toContain(
      "#EXT-X-PRELOAD-HINT"
    );
  });

  test("does not emit content steering", () => {
    expect(renderMediaPlaylist(committedWindow, options)).not.toContain(
      "#EXT-X-CONTENT-STEERING"
    );
  });

  test("does not emit track reports", () => {
    expect(renderMediaPlaylist(committedWindow, options)).not.toContain(
      "#EXT-X-TRACK-REPORT"
    );
  });

  test("omits program date-time tags for segments without program dates", () => {
    const playlist = renderMediaPlaylist(
      {
        ...committedWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: validTrack().segments.map(withoutProgramDateTime),
          },
        },
      },
      options
    );

    expect(playlist).not.toContain("#EXT-X-PROGRAM-DATE-TIME");
    expect(playlist).toContain("#EXTINF:2.000,");
  });

  test("renders byterange parts and EXT-X-PRELOAD-HINT for the in-progress segment", () => {
    const segmentDeliveryUrl =
      "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812-3812.m4s";
    const segmentObjectKey =
      "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812-3812.m4s";

    const playlist = renderMediaPlaylist(
      {
        ...committedWindow,
        firstSequenceNumber: 3812,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [
              {
                sequenceNumber: 3812,
                parts: [
                  {
                    byterange: {
                      length: 12_500,
                      offset: 0,
                      segmentDeliveryUrl,
                      segmentObjectKey,
                    },
                    commitId: "commit_3812_0",
                    deliveryUrl:
                      "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p0.m4s",
                    objectKey:
                      "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p0.m4s",
                    partNumber: 0,
                    profile: { duration: 0.5, independent: true },
                    slotId: "slot_3812_0",
                  },
                  {
                    byterange: {
                      length: 11_900,
                      offset: 12_500,
                      segmentDeliveryUrl,
                      segmentObjectKey,
                    },
                    commitId: "commit_3812_1",
                    deliveryUrl:
                      "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p1.m4s",
                    objectKey:
                      "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p1.m4s",
                    partNumber: 1,
                    profile: { duration: 0.5 },
                    slotId: "slot_3812_1",
                  },
                ],
              },
            ],
          },
        },
      },
      options
    );

    expect(playlist).toContain(
      `#EXT-X-PART:DURATION=0.500,INDEPENDENT=YES,URI="${segmentDeliveryUrl}",BYTERANGE="12500@0"`
    );
    expect(playlist).toContain(
      `#EXT-X-PART:DURATION=0.500,URI="${segmentDeliveryUrl}",BYTERANGE="11900@12500"`
    );
    expect(playlist).toContain(
      `#EXT-X-PRELOAD-HINT:TYPE=PART,URI="${segmentDeliveryUrl}",BYTERANGE-START=24400`
    );
  });

  test("renders part-only segments without full-segment EXTINF entries", () => {
    const playlist = renderMediaPlaylist(
      {
        ...committedWindow,
        firstSequenceNumber: 3812,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [validTrack().segments[2] ?? missingSegment()],
          },
        },
      },
      options
    );

    expect(playlist).not.toContain("#EXTINF:");
    expect(playlist).toContain(
      '#EXT-X-PART:DURATION=0.500,INDEPENDENT=YES,URI="https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p0-slot_3812_0.m4s"'
    );
    expect(playlist).toContain(
      '#EXT-X-PART:DURATION=0.500,URI="https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p1-slot_3812_1.m4s"'
    );
  });

  test("retains parts on completed segments within three target durations of the end", () => {
    // Four 1080p segments: three full 2s segments each carrying two 1s
    // parts, then a trailing in-progress (parts-only) segment with two 1s
    // parts (2s total). Walking back from the end (RFC 8216bis §6.2.2, floor
    // = 3 * segmentTarget = 6s):
    //   trailing (parts-only, always shown)   distance 0s -> +2s
    //   3812 (newest full segment)             distance 2s < 6s -> retained
    //   3811 (middle full segment)             distance 4s < 6s -> retained
    //   3810 (oldest full segment)             distance 6s, NOT < 6s -> dropped
    const fullPart = (partNumber: 0 | 1, sequenceNumber: number) => ({
      commitId: `commit_${sequenceNumber}_${partNumber}`,
      deliveryUrl: `${MEDIA_ORIGIN}/media/${sequenceNumber}/p${partNumber}.m4s`,
      objectKey: `media/${sequenceNumber}/p${partNumber}.m4s`,
      partNumber,
      profile: { duration: 1 },
      slotId: `slot_${sequenceNumber}_${partNumber}`,
    });

    const fullSegment = (sequenceNumber: number): CommittedSegment => ({
      parts: [fullPart(0, sequenceNumber), fullPart(1, sequenceNumber)],
      segment: {
        commitId: `commit_${sequenceNumber}`,
        deliveryUrl: `${MEDIA_ORIGIN}/media/${sequenceNumber}.m4s`,
        objectKey: `media/${sequenceNumber}.m4s`,
        profile: { duration: 2 },
        slotId: `slot_${sequenceNumber}`,
      },
      sequenceNumber,
    });

    const trailingSegment: CommittedSegment = {
      parts: [fullPart(0, 3813), fullPart(1, 3813)],
      sequenceNumber: 3813,
    };

    const playlist = renderMediaPlaylist(
      {
        ...committedWindow,
        lastSequenceNumber: 3813,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: [
              fullSegment(3810),
              fullSegment(3811),
              fullSegment(3812),
              trailingSegment,
            ],
          },
        },
      },
      { ...options, partTarget: 1 }
    );

    expect(playlist).toContain(
      `#EXT-X-PART:DURATION=1.000,URI="${MEDIA_ORIGIN}/media/3812/p0.m4s"`
    );
    expect(playlist).toContain(
      `#EXT-X-PART:DURATION=1.000,URI="${MEDIA_ORIGIN}/media/3812/p1.m4s"`
    );
    expect(playlist).toContain(
      `#EXT-X-PART:DURATION=1.000,URI="${MEDIA_ORIGIN}/media/3811/p0.m4s"`
    );
    expect(playlist).toContain(
      `#EXT-X-PART:DURATION=1.000,URI="${MEDIA_ORIGIN}/media/3811/p1.m4s"`
    );
    expect(playlist).not.toContain("media/3810/p0.m4s");
    expect(playlist).not.toContain("media/3810/p1.m4s");
    // Retained parts render before the segment's own EXTINF line.
    expect(playlist).toContain(
      `#EXT-X-PART:DURATION=1.000,URI="${MEDIA_ORIGIN}/media/3812/p1.m4s"\n#EXTINF:2.000,\n${MEDIA_ORIGIN}/media/3812.m4s`
    );
    // No preload hint on a completed segment's retained parts.
    expect(playlist).not.toContain("#EXT-X-PRELOAD-HINT");
  });

  test("throws for parts without a media duration", () => {
    const inProgress = validTrack().segments[2] ?? missingSegment();

    expect(() =>
      renderMediaPlaylist(
        {
          ...committedWindow,
          firstSequenceNumber: 3812,
          tracks: {
            v1080: {
              ...validTrack(),
              segments: [
                {
                  ...inProgress,
                  parts: (inProgress.parts ?? []).map((part) => ({
                    ...part,
                    profile: { independent: part.profile?.independent },
                  })),
                },
              ],
            },
          },
        },
        options
      )
    ).toThrow("part 0 has no media duration");
  });

  test("refuses non-monotonic committed windows", () => {
    expect(() =>
      renderMediaPlaylist(
        {
          ...committedWindow,
          tracks: {
            v1080: {
              ...validTrack(),
              segments: [...validTrack().segments].reverse(),
            },
          },
        },
        options
      )
    ).toThrow(
      "committedWindow.tracks.v1080.segments must have monotonic sequence numbers"
    );
  });

  test("renders discontinuities before flagged segments", () => {
    const playlist = renderMediaPlaylist(
      {
        ...committedWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: validTrack().segments.map((segment) =>
              segment.sequenceNumber === 3811 && segment.segment
                ? {
                    ...segment,
                    segment: {
                      ...segment.segment,
                      profile: {
                        ...segment.segment.profile,
                        discontinuityBefore: true,
                      },
                    },
                  }
                : segment
            ),
          },
        },
      },
      { ...options, discontinuitySequence: 1 }
    );

    expect(playlist).toContain(`#EXT-X-DISCONTINUITY-SEQUENCE:1
#EXT-X-MAP:URI=`);
    expect(playlist).toContain(`#EXT-X-DISCONTINUITY
#EXT-X-PROGRAM-DATE-TIME:2026-06-08T12:00:02.000Z
#EXTINF:2.000,
https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3811-slot_s3811.m4s`);
  });

  test("renders discontinuities flagged on the first part of an in-progress segment", () => {
    const playlist = renderMediaPlaylist(
      {
        ...committedWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            segments: validTrack().segments.map((segment) =>
              segment.sequenceNumber === 3812
                ? {
                    ...segment,
                    parts: (segment.parts ?? []).map((part) =>
                      part.partNumber === 0
                        ? {
                            ...part,
                            profile: {
                              ...part.profile,
                              discontinuityBefore: true,
                            },
                          }
                        : part
                    ),
                  }
                : segment
            ),
          },
        },
      },
      options
    );

    expect(playlist).toContain(`#EXT-X-DISCONTINUITY
#EXT-X-PROGRAM-DATE-TIME:2026-06-08T12:00:04.000Z
#EXT-X-PART:DURATION=0.500,INDEPENDENT=YES`);
  });

  test("renders the track window's own discontinuity sequence when set", () => {
    const playlist = renderMediaPlaylist(
      {
        ...committedWindow,
        tracks: {
          v1080: {
            ...validTrack(),
            profile: { discontinuitySequence: 3 },
          },
        },
      },
      { ...options, discontinuitySequence: 1 }
    );

    expect(playlist).toContain("#EXT-X-DISCONTINUITY-SEQUENCE:3");
    expect(playlist).not.toContain("#EXT-X-DISCONTINUITY-SEQUENCE:1");
  });

  test("falls back to the baseline discontinuity sequence when the track sets none", () => {
    expect(
      renderMediaPlaylist(committedWindow, {
        ...options,
        discontinuitySequence: 2,
      })
    ).toContain("#EXT-X-DISCONTINUITY-SEQUENCE:2");
  });

  test("rejects absolute media URLs without an allowed origin", () => {
    expect(() =>
      renderMediaPlaylist(committedWindow, {
        partTarget: 0.5,
        trackId: "v1080",
        segmentTarget: 2,
      })
    ).toThrow("track.init.deliveryUrl origin is not allowed");
  });

  test("rejects unsafe media URL schemes", () => {
    expect(() =>
      renderMediaPlaylist(withInitDeliveryUrl("javascript:alert(1)"), options)
    ).toThrow(
      "committedWindow.tracks.v1080.init.deliveryUrl must be an absolute HTTP(S) URL or safe relative path"
    );
  });

  test("rejects protocol-relative media URLs", () => {
    expect(() =>
      renderMediaPlaylist(
        withInitDeliveryUrl("//media.example.com/init.mp4"),
        options
      )
    ).toThrow(
      "committedWindow.tracks.v1080.init.deliveryUrl must be an absolute HTTP(S) URL or safe relative path"
    );
  });

  test("rejects relative media URLs with query strings or fragments", () => {
    expect(() =>
      renderMediaPlaylist(
        withInitDeliveryUrl("/media/v1080/init.mp4?token=abc"),
        {
          partTarget: 0.5,
          trackId: "v1080",
          segmentTarget: 2,
        }
      )
    ).toThrow(
      "committedWindow.tracks.v1080.init.deliveryUrl must not contain query strings or fragments"
    );
  });

  test("rejects media URLs with control characters", () => {
    expect(() =>
      renderMediaPlaylist(
        withInitDeliveryUrl("/media/v1080/init.mp4\n#EXT-X-ENDLIST"),
        {
          partTarget: 0.5,
          trackId: "v1080",
          segmentTarget: 2,
        }
      )
    ).toThrow(
      "committedWindow.tracks.v1080.init.deliveryUrl must not contain control characters"
    );
  });
});
