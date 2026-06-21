import { describe, expect, test } from "bun:test";
import { S3Client } from "@aws-sdk/client-s3";
import { createTestS3Client } from "./test-client.test-helper";

describe("createTestS3Client", () => {
  test("creates a deterministic S3 client for tests", async () => {
    const client = createTestS3Client();

    expect(client).toBeInstanceOf(S3Client);
    await expect(client.config.region()).resolves.toBe("us-east-1");
    expect(client.config.forcePathStyle).toBe(true);
  });
});
