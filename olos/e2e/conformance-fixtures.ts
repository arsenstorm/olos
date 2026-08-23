import {
  createRuntimeObjectLowLatencyProfile,
  type MediaSession,
} from "@arsenstorm/olos/media";
import type { CommittedWindow } from "@arsenstorm/olos/types";

const latency = createRuntimeObjectLowLatencyProfile();

export const conformanceSession = {
  createdAt: "2026-06-08T12:00:00Z",
  epoch: 1,
  olos: "1.0",
  profile: {
    id: "cmaf-llhls",
    partTarget: latency.partTarget,
    segmentTarget: latency.segmentTarget,
  },
  sessionId: "sess_01JZLIVE",
  state: "live",
  tracks: [
    {
      profile: {
        bitrate: 5_000_000,
        codec: "avc1.640028",
        frameRate: 30,
        height: 1080,
        kind: "video",
        width: 1920,
      },
      trackId: "v1080",
    },
    {
      profile: {
        bitrate: 2_800_000,
        codec: "avc1.4d401f",
        frameRate: 30,
        height: 720,
        kind: "video",
        width: 1280,
      },
      trackId: "v720",
    },
    {
      profile: {
        bitrate: 128_000,
        channels: 2,
        codec: "mp4a.40.2",
        kind: "audio",
        sampleRate: 48_000,
      },
      trackId: "a128",
    },
  ],
} satisfies MediaSession;

export const conformanceCommittedWindow = {
  epoch: 1,
  firstSequenceNumber: 3810,
  lastSequenceNumber: 3812,
  tracks: {
    v1080: {
      init: {
        commitId: "commit_init_v1080",
        deliveryUrl:
          "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/init-slot_init_v1080.mp4",
        objectKey:
          "media/tenant_acme/sess_01JZLIVE/e1/v1080/init-slot_init_v1080.mp4",
        slotId: "slot_init_v1080",
      },
      segments: [
        {
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
          sequenceNumber: 3810,
        },
        {
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
          sequenceNumber: 3811,
        },
        {
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
          sequenceNumber: 3812,
        },
      ],
      trackId: "v1080",
    },
  },
} satisfies CommittedWindow;
