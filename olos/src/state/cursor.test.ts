import { describe, expect, test } from "bun:test";
import type { CommittedWindow } from "../types/committed-window";
import { createCursor } from "./cursor";

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
  partTarget: 0.333,
  pathways: [
    {
      baseUrl: "https://media.example.com",
      pathwayId: "primary",
      priority: 0,
      providerId: "provider_1",
      state: "active",
    },
  ],
  segmentTarget: 1,
  sessionId: "session_1",
  state: "live",
  tenantId: "tenant_1",
  updatedAt: "2026-06-08T12:00:01.820Z",
} as const;

describe("cursor builder", () => {
  test("derives a valid cursor from a committed window", () => {
    expect(createCursor(options)).toEqual({
      committedWindow,
      epoch: 7,
      latencyProfile: "object-ll",
      olos: "1.0",
      partTarget: 0.333,
      pathways: [...options.pathways],
      segmentTarget: 1,
      sessionId: "session_1",
      state: "live",
      tenantId: "tenant_1",
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
