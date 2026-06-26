import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, test } from "vitest";
import {
  createTestDeleteObjectClient,
  createTestHeadObjectClient,
  createTestHeadObjectClientFor,
} from "./fake-s3-clients";

describe("fake S3 clients", () => {
  test("records HeadObject inputs through the shared test helper", async () => {
    const inputs: unknown[] = [];
    const client = createTestHeadObjectClient(inputs, 1024);

    const result = await client.send(
      new HeadObjectCommand({ Bucket: "media", Key: "live/object.m4s" })
    );

    expect(result.ContentLength).toBe(1024);
    expect(inputs).toEqual([{ Bucket: "media", Key: "live/object.m4s" }]);
  });

  test("records DeleteObject inputs through the shared test helper", async () => {
    const inputs: unknown[] = [];
    const client = createTestDeleteObjectClient(inputs);

    await client.send(
      new DeleteObjectCommand({ Bucket: "media", Key: "live/object.m4s" })
    );

    expect(inputs).toEqual([{ Bucket: "media", Key: "live/object.m4s" }]);
  });

  test("preserves the historical E2E HeadObject argument order", async () => {
    const inputs: unknown[] = [];
    const client = createTestHeadObjectClientFor(
      { "live/object.m4s": 2048 },
      inputs
    );

    const result = await client.send(
      new HeadObjectCommand({ Bucket: "media", Key: "live/object.m4s" })
    );

    expect(result.ContentLength).toBe(2048);
    expect(inputs).toEqual([{ Bucket: "media", Key: "live/object.m4s" }]);
  });
});
