import { createRuntimeObjectLowLatencyProfile } from "@arsenstorm/olos/runtime";
import type { CommittedWindow, Session } from "@arsenstorm/olos/types";

const latency = createRuntimeObjectLowLatencyProfile();

export const conformanceSession = {
  createdAt: "2026-06-08T12:00:00Z",
  epoch: 1,
  latencyProfile: latency.latencyProfile,
  olos: "1.0",
  partTarget: latency.partTarget,
  renditions: [
    {
      bitrate: 5_000_000,
      codec: "avc1.640028",
      frameRate: 30,
      height: 1080,
      kind: "video",
      renditionId: "v1080",
      width: 1920,
    },
    {
      bitrate: 2_800_000,
      codec: "avc1.4d401f",
      frameRate: 30,
      height: 720,
      kind: "video",
      renditionId: "v720",
      width: 1280,
    },
    {
      bitrate: 128_000,
      channels: 2,
      codec: "mp4a.40.2",
      kind: "audio",
      renditionId: "a128",
      sampleRate: 48_000,
    },
  ],
  segmentTarget: latency.segmentTarget,
  sessionId: "sess_01JZLIVE",
  state: "live",
} satisfies Session;

export const conformanceCommittedWindow = {
  discontinuitySequence: 0,
  epoch: 1,
  firstMediaSequenceNumber: 3810,
  lastMediaSequenceNumber: 3812,
  renditions: {
    v1080: {
      init: {
        commitId: "commit_init_v1080",
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
} satisfies CommittedWindow;
