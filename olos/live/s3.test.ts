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
    let testError: unknown;
    let cleanupError: unknown;

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
    } catch (error) {
      testError = error;
    } finally {
      try {
        await client.send(
          new DeleteObjectCommand({
            Bucket: config.bucket,
            Key: objectKey,
          })
        );
      } catch (error) {
        cleanupError = error;
      }
    }

    if (testError !== undefined && cleanupError !== undefined) {
      throw new AggregateError(
        [testError, cleanupError],
        "live S3 test failed and cleanup also failed"
      );
    }

    if (testError !== undefined) {
      throw testError;
    }

    if (cleanupError !== undefined) {
      throw cleanupError;
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

  const required = readRequiredLiveS3Env([
    "OLOS_LIVE_S3_ACCESS_KEY_ID",
    "OLOS_LIVE_S3_BUCKET",
    "OLOS_LIVE_S3_REGION",
    "OLOS_LIVE_S3_SECRET_ACCESS_KEY",
  ]);

  return {
    accessKeyId: required.OLOS_LIVE_S3_ACCESS_KEY_ID,
    bucket: required.OLOS_LIVE_S3_BUCKET,
    endpoint: process.env.OLOS_LIVE_S3_ENDPOINT,
    forcePathStyle: boolEnv(
      "OLOS_LIVE_S3_FORCE_PATH_STYLE",
      process.env.OLOS_LIVE_S3_ENDPOINT !== undefined
    ),
    prefix: readLiveS3Prefix(),
    region: required.OLOS_LIVE_S3_REGION,
    secretAccessKey: required.OLOS_LIVE_S3_SECRET_ACCESS_KEY,
    status: "enabled",
  };
}

function readLiveS3Prefix(): string {
  const prefix = (process.env.OLOS_LIVE_S3_PREFIX ?? "olos-live-s3").replace(
    /^\/+|\/+$/g,
    ""
  );

  if (
    prefix === "" ||
    hasControlCharacter(prefix) ||
    prefix.includes("?") ||
    prefix.includes("#") ||
    prefix
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(
      "OLOS_LIVE_S3_PREFIX must be a safe relative object prefix"
    );
  }

  return prefix;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }

  return false;
}

function readRequiredLiveS3Env<const Names extends readonly string[]>(
  names: Names
): Record<Names[number], string> {
  const missing = names.filter(
    (name) => process.env[name] === undefined || process.env[name] === ""
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required live S3 env when OLOS_LIVE_S3=1: ${missing.join(", ")}`
    );
  }

  return Object.fromEntries(
    names.map((name) => [name, process.env[name]])
  ) as Record<Names[number], string>;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];

  if (value === undefined) {
    return fallback;
  }

  if (value === "1" || value.toLowerCase() === "true") {
    return true;
  }

  if (value === "0" || value.toLowerCase() === "false") {
    return false;
  }

  throw new Error(`${name} must be true, false, 1, or 0`);
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
