import { describe, expect, test } from "bun:test";

import { deleteRetiredS3CoordinatorObjects } from "./retention";
import { createTestS3DeleteObjectClient } from "./test-delete-client.test-helper";

describe("S3 retention", () => {
  test("does not send delete commands when there are no retired objects", async () => {
    const inputs: unknown[] = [];

    const result = await deleteRetiredS3CoordinatorObjects({
      bucket: "media",
      client: createTestS3DeleteObjectClient(inputs),
      objects: [],
    });

    expect(inputs).toEqual([]);
    expect(result).toEqual({
      deletedObjects: [],
      failedObjects: [],
    });
  });

  test("deletes retired coordinator objects from S3", async () => {
    const inputs: unknown[] = [];

    const result = await deleteRetiredS3CoordinatorObjects({
      bucket: "media",
      client: createTestS3DeleteObjectClient(inputs),
      objects: [
        {
          commitId: "commit_3810",
          objectKey: "media/s3810.m4s",
          slotId: "slot_3810",
        },
      ],
    });

    expect(inputs).toEqual([
      {
        Bucket: "media",
        Key: "media/s3810.m4s",
      },
    ]);
    expect(result).toEqual({
      deletedObjects: [
        {
          commitId: "commit_3810",
          objectKey: "media/s3810.m4s",
          slotId: "slot_3810",
        },
      ],
      failedObjects: [],
    });
  });

  test("keeps deleting S3 objects after a failed delete", async () => {
    const inputs: unknown[] = [];

    const result = await deleteRetiredS3CoordinatorObjects({
      bucket: "media",
      client: createTestS3DeleteObjectClient(inputs, "media/fail.m4s"),
      objects: [
        {
          commitId: "commit_fail",
          objectKey: "media/fail.m4s",
          slotId: "slot_fail",
        },
        {
          commitId: "commit_ok",
          objectKey: "media/ok.m4s",
          slotId: "slot_ok",
        },
      ],
    });

    expect(inputs).toEqual([
      {
        Bucket: "media",
        Key: "media/fail.m4s",
      },
      {
        Bucket: "media",
        Key: "media/ok.m4s",
      },
    ]);
    expect(result.deletedObjects).toEqual([
      {
        commitId: "commit_ok",
        objectKey: "media/ok.m4s",
        slotId: "slot_ok",
      },
    ]);
    expect(result.failedObjects).toEqual([
      {
        error: "delete failed",
        object: {
          commitId: "commit_fail",
          objectKey: "media/fail.m4s",
          slotId: "slot_fail",
        },
      },
    ]);
  });

  test("rejects empty S3 retention buckets before deleting objects", async () => {
    const inputs: unknown[] = [];

    await expect(
      deleteRetiredS3CoordinatorObjects({
        bucket: "",
        client: createTestS3DeleteObjectClient(inputs),
        objects: [
          {
            commitId: "commit_3810",
            objectKey: "media/s3810.m4s",
            slotId: "slot_3810",
          },
        ],
      })
    ).rejects.toThrow("bucket must be a non-empty string");
    await expect(
      deleteRetiredS3CoordinatorObjects({
        bucket: "media/live",
        client: createTestS3DeleteObjectClient(inputs),
        objects: [
          {
            commitId: "commit_3810",
            objectKey: "media/s3810.m4s",
            slotId: "slot_3810",
          },
        ],
      })
    ).rejects.toThrow("bucket must not contain path separators");
    expect(inputs).toEqual([]);
  });

  test("records unsafe S3 retention object keys as failed deletes", async () => {
    const inputs: unknown[] = [];

    const result = await deleteRetiredS3CoordinatorObjects({
      bucket: "media",
      client: createTestS3DeleteObjectClient(inputs),
      objects: [
        {
          commitId: "commit_bad",
          objectKey: "media/../secret.m4s",
          slotId: "slot_bad",
        },
        {
          commitId: "commit_ok",
          objectKey: "media/ok.m4s",
          slotId: "slot_ok",
        },
      ],
    });

    expect(inputs).toEqual([
      {
        Bucket: "media",
        Key: "media/ok.m4s",
      },
    ]);
    expect(result.deletedObjects).toEqual([
      {
        commitId: "commit_ok",
        objectKey: "media/ok.m4s",
        slotId: "slot_ok",
      },
    ]);
    expect(result.failedObjects).toEqual([
      {
        error: "objectKey must be a safe relative object key",
        object: {
          commitId: "commit_bad",
          objectKey: "media/../secret.m4s",
          slotId: "slot_bad",
        },
      },
    ]);
  });
});
