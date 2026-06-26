import { randomUUID } from "node:crypto";
import {
  createPresignedS3UploadGrant,
  deleteRetiredS3CoordinatorObjects,
  observeS3Object,
} from "@arsenstorm/olos/s3";
import type { UploadSlot } from "@arsenstorm/olos/types";
import { S3Client } from "@aws-sdk/client-s3";
import { expect, test } from "vitest";
import { readLiveS3ConfigFromEnv } from "./s3-config";

const contentType = "application/octet-stream";
const payload = new TextEncoder().encode("olos live s3 integration\n");
const overwritePayload = new TextEncoder().encode("olos overwrite attempt\n");
const liveS3Config = readLiveS3ConfigFromEnv(process.env);

test.skipIf(liveS3Config.status === "disabled")(
  "uploads, rejects overwrite, and observes an object through a live S3-compatible provider",
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
    let cleanupResult: Awaited<
      ReturnType<typeof deleteRetiredS3CoordinatorObjects>
    >;
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

      const overwrite = await fetch(grant.url, {
        body: overwritePayload,
        headers: grant.requiredHeaders,
        method: grant.method,
      });

      expect(overwrite.ok).toBe(false);

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
        cleanupResult = await deleteRetiredS3CoordinatorObjects({
          bucket: config.bucket,
          client,
          objects: [
            {
              commitId: "live_commit",
              objectKey,
              slotId: slot.slotId,
            },
          ],
        });

        if (cleanupResult.failedObjects.length > 0) {
          cleanupError = new Error("live S3 cleanup failed");
        }
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

    expect(cleanupResult).toEqual({
      deletedObjects: [
        {
          commitId: "live_commit",
          objectKey,
          slotId: slot.slotId,
        },
      ],
      failedObjects: [],
    });
  }
);

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
