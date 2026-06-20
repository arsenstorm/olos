import { describe, expect, test } from "bun:test";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createTestS3DeleteObjectClient } from "./test-delete-client.test";

describe("createTestS3DeleteObjectClient", () => {
  test("records delete command inputs", async () => {
    const inputs: unknown[] = [];
    const client = createTestS3DeleteObjectClient(inputs);

    await client.send(
      new DeleteObjectCommand({
        Bucket: "media",
        Key: "media/s3810.m4s",
      })
    );

    expect(inputs).toEqual([
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
  });

  test("throws for the configured failing key after recording input", () => {
    const inputs: unknown[] = [];
    const client = createTestS3DeleteObjectClient(inputs, "media/fail.m4s");

    expect(() =>
      client.send(
        new DeleteObjectCommand({
          Bucket: "media",
          Key: "media/fail.m4s",
        })
      )
    ).toThrow("delete failed");
    expect(inputs).toEqual([
      {
        Bucket: "media",
        Key: "media/fail.m4s",
      },
    ]);
  });
});
