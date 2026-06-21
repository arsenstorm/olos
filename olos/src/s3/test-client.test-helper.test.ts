import { describe, expect, test } from "bun:test";
import type { HeadObjectCommand } from "@aws-sdk/client-s3";
import { S3Client } from "@aws-sdk/client-s3";
import {
  createTestHeadObjectClientFor,
  createTestHeadObjectClientForSingle,
  createTestS3Client,
} from "./test-client.test-helper";

describe("createTestS3Client", () => {
  test("creates a deterministic S3 client for tests", async () => {
    const client = createTestS3Client();

    expect(client).toBeInstanceOf(S3Client);
    await expect(client.config.region()).resolves.toBe("us-east-1");
    expect(client.config.forcePathStyle).toBe(true);
  });
});

describe("createTestHeadObjectClient", () => {
  test("creates deterministic head-object responses and captures command inputs", async () => {
    const headObjectInputs: unknown[] = [];
    const client = createTestHeadObjectClientFor(
      headObjectInputs,
      { "media/v1080.m4s": 98_304 },
      { "media/v1080.m4s": "video/part" },
      { "media/v1080.m4s": "2026-01-01T00:00:02.000Z" },
      {
        metadata: {
          "media/v1080.m4s": {
            "x-olos-slot-id": "slot_1080",
          },
        },
      }
    );

    const output = await client.send({
      input: {
        Bucket: "media",
        Key: "media/v1080.m4s",
      },
    } as HeadObjectCommand);

    expect(output.ContentLength).toBe(98_304);
    expect(output.ContentType).toBe("video/part");
    expect(output.Metadata).toEqual({
      "x-olos-slot-id": "slot_1080",
    });
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/v1080.m4s",
      },
    ]);
  });

  test("supports metadata and custom missing-object errors", async () => {
    const headObjectInputs: unknown[] = [];
    const client = createTestHeadObjectClientForSingle(
      "media/v1080/3810.m4s",
      98_304,
      headObjectInputs,
      "video/mp4",
      {
        "x-olos-slot-id": "slot_3810",
      },
      (objectKey) => `missing object: ${objectKey}`
    );

    await client.send({
      input: {
        Bucket: "media",
        Key: "media/v1080/3810.m4s",
      },
    } as HeadObjectCommand);

    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/v1080/3810.m4s",
      },
    ]);

    await expect(
      client.send({
        input: {
          Bucket: "media",
          Key: "media/other.m4s",
        },
      } as HeadObjectCommand)
    ).rejects.toThrow("missing object: media/other.m4s");
  });
});
