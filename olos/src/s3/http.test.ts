import { describe, expect, test } from "bun:test";
import { S3Client } from "@aws-sdk/client-s3";

import { createMemoryCoordinatorStore } from "../protocol";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import { createStoredS3CoordinatorRuntimeHandler } from "./http";

const session: Session = {
  createdAt: "2026-01-01T00:00:00.000Z",
  epoch: 1,
  latencyProfile: "object-ll",
  olos: "1.0",
  partTarget: 0.5,
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
  ],
  segmentTarget: 2,
  sessionId: "session_1",
  state: "live",
  tenantId: "tenant_1",
};

const pathways: Pathway[] = [
  {
    baseUrl: "https://media.example.com",
    pathwayId: "primary",
    priority: 0,
    providerId: "s3_primary",
    state: "active",
  },
];

describe("stored S3 coordinator runtime handler", () => {
  test("delegates runtime routes and issues S3 upload grants", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      grantNow: () => "2026-01-01T00:00:00.000Z",
      store,
    });

    const created = await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
        session,
      })
    );
    const grant = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/s3/slots",
        slotPayload()
      )
    );
    const body = (await grant.json()) as {
      grant: {
        expiresAt: string;
        method: string;
        requiredHeaders: Record<string, string>;
        slotId: string;
        url: string;
      };
      slot: {
        objectKey: string;
        slotId: string;
        state: string;
      };
    };
    const stored = await store.load(session.sessionId);

    expect(created.status).toBe(201);
    expect(grant.status).toBe(201);
    expect(body.slot).toMatchObject({
      objectKey: "live/session/v1080/3810.m4s",
      slotId: "slot_3810",
      state: "issued",
    });
    expect(body.grant).toMatchObject({
      expiresAt: "2026-01-01T00:00:03.000Z",
      method: "PUT",
      requiredHeaders: {
        "Content-Type": "video/mp4",
        "If-None-Match": "*",
        "x-olos-slot-id": "slot_3810",
      },
      slotId: "slot_3810",
    });
    expect(new URL(body.grant.url).pathname).toBe(
      "/media/live/session/v1080/3810.m4s"
    );
    expect(stored?.state.slots).toHaveLength(1);
  });

  test("returns S3 route errors without swallowing base routes", async () => {
    const handle = createStoredS3CoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      store: createMemoryCoordinatorStore(),
    });

    expect(
      await handle(
        new Request("https://edge.example.com/sessions/missing/s3/slots")
      )
    ).toHaveProperty("status", 405);
    expect(
      await handle(
        jsonRequest(
          "https://edge.example.com/sessions/missing/s3/slots",
          slotPayload()
        )
      )
    ).toHaveProperty("status", 404);
    expect(
      await handle(new Request("https://edge.example.com/unknown"))
    ).toHaveProperty("status", 404);
  });
});

function slotPayload() {
  return {
    contentType: "video/mp4",
    deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
    duration: 2,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: "segment",
    maxBytes: 100_000,
    mediaSequenceNumber: 3810,
    objectKey: "live/session/v1080/3810.m4s",
    publicationMode: "direct-public" as const,
    publisherInstanceId: "pub_1",
    renditionId: "v1080",
    slotId: "slot_3810",
  };
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function createClient(): S3Client {
  return new S3Client({
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    endpoint: "https://s3.example.com",
    forcePathStyle: true,
    region: "us-east-1",
  });
}
