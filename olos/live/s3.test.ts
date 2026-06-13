import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createPresignedS3UploadGrant, observeS3Object } from "olos/s3";
import type { UploadSlot } from "olos/types";
import { expect, test } from "vitest";

const contentType = "application/octet-stream";
const payload = new TextEncoder().encode("olos live s3 integration\n");
const liveS3Config = readLiveS3Config();

test.skipIf(liveS3Config.status === "disabled")(
  "uploads and observes an object through a live S3-compatible provider",
  async () => {
    if (liveS3Config.status === "disabled") {
      throw new Error("live S3 test is disabled");
    }

    const config = liveS3Config;
    const client = new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
      forcePathStyle: config.forcePathStyle,
      region: config.region,
    });
    const objectKey = `${config.prefix}/${randomUUID()}.bin`;
    const slot = createSlot(objectKey);

    try {
      const grant = await createPresignedS3UploadGrant({
        bucket: config.bucket,
        client,
        expiresInSeconds: 60,
        slot,
      });
      const uploaded = await fetch(grant.url, {
        body: payload,
        headers: grant.requiredHeaders,
        method: grant.method,
      });

      if (!uploaded.ok) {
        throw new Error(`live S3 upload failed with ${uploaded.status}`);
      }

      const observed = await observeS3Object({
        bucket: config.bucket,
        client,
        objectKey,
        observedAt: "2026-01-01T00:00:01.000Z",
        providerId: "live_s3",
      });

      expect(observed).toMatchObject({
        contentType,
        metadata: {
          "x-olos-slot-id": slot.slotId,
        },
        objectKey,
        providerId: "live_s3",
        size: payload.byteLength,
      });
    } finally {
      await client.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: objectKey,
        })
      );
    }
  }
);

type LiveS3Config =
  | { status: "disabled" }
  | {
      accessKeyId: string;
      bucket: string;
      endpoint?: string;
      forcePathStyle: boolean;
      prefix: string;
      region: string;
      secretAccessKey: string;
      status: "enabled";
    };

function readLiveS3Config(): LiveS3Config {
  if (process.env.OLOS_LIVE_S3 !== "1") {
    return { status: "disabled" };
  }

  return {
    accessKeyId: requiredEnv("OLOS_LIVE_S3_ACCESS_KEY_ID"),
    bucket: requiredEnv("OLOS_LIVE_S3_BUCKET"),
    endpoint: process.env.OLOS_LIVE_S3_ENDPOINT,
    forcePathStyle: boolEnv(
      "OLOS_LIVE_S3_FORCE_PATH_STYLE",
      process.env.OLOS_LIVE_S3_ENDPOINT !== undefined
    ),
    prefix: process.env.OLOS_LIVE_S3_PREFIX ?? "olos-live-s3",
    region: requiredEnv("OLOS_LIVE_S3_REGION"),
    secretAccessKey: requiredEnv("OLOS_LIVE_S3_SECRET_ACCESS_KEY"),
    status: "enabled",
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === "") {
    throw new Error(`${name} is required when OLOS_LIVE_S3=1`);
  }

  return value;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];

  if (value === undefined) {
    return fallback;
  }

  return value === "1" || value.toLowerCase() === "true";
}

function createSlot(objectKey: string): UploadSlot {
  return {
    contentType,
    deliveryUrl: `https://media.example.com/${objectKey}`,
    duration: 1,
    epoch: 1,
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    kind: "segment",
    maxBytes: payload.byteLength,
    mediaSequenceNumber: 1,
    objectKey,
    publicationMode: "direct-public",
    publisherInstanceId: "live_publisher",
    renditionId: "live",
    sessionId: "live_session",
    slotId: `slot_${randomUUID()}`,
    state: "issued",
    tenantId: "live_tenant",
  };
}
