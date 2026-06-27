import { describe, expect, test } from "bun:test";

import type { RetiredCoordinatorObjectDeletion } from "../runtime/retention";
import { deleteRetiredS3CoordinatorObjects } from "./retention";
import { createTestS3DeleteObjectClient } from "./test-delete-client.test-helper";

const RETIRED_OBJECT: RetiredCoordinatorObjectDeletion = {
  commitId: "commit_3810",
  objectKey: "media/v1080/s3810.m4s",
  slotId: "slot_3810",
};

const FAILED_RETIRED_OBJECT: RetiredCoordinatorObjectDeletion = {
  commitId: "commit_fail",
  objectKey: "media/fail.m4s",
  slotId: "slot_fail",
};

const OK_RETIRED_OBJECT: RetiredCoordinatorObjectDeletion = {
  commitId: "commit_ok",
  objectKey: "media/ok.m4s",
  slotId: "slot_ok",
};

const UNSAFE_RETIRED_OBJECT: RetiredCoordinatorObjectDeletion = {
  commitId: "commit_bad",
  objectKey: "media/../secret.m4s",
  slotId: "slot_bad",
};

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
      objects: [RETIRED_OBJECT],
    });

    expect(inputs).toEqual([
      {
        Bucket: "media",
        Key: "media/v1080/s3810.m4s",
      },
    ]);
    expect(result).toEqual({
      deletedObjects: [RETIRED_OBJECT],
      failedObjects: [],
    });
  });

  test("keeps deleting S3 objects after a failed delete", async () => {
    const inputs: unknown[] = [];

    const result = await deleteRetiredS3CoordinatorObjects({
      bucket: "media",
      client: createTestS3DeleteObjectClient(inputs, "media/fail.m4s"),
      objects: [FAILED_RETIRED_OBJECT, OK_RETIRED_OBJECT],
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
    expect(result.deletedObjects).toEqual([OK_RETIRED_OBJECT]);
    expect(result.failedObjects).toEqual([
      {
        error: "delete failed",
        object: FAILED_RETIRED_OBJECT,
      },
    ]);
  });

  test("rejects empty S3 retention buckets before deleting objects", async () => {
    const inputs: unknown[] = [];

    await expect(
      deleteRetiredS3CoordinatorObjects({
        bucket: "",
        client: createTestS3DeleteObjectClient(inputs),
        objects: [RETIRED_OBJECT],
      })
    ).rejects.toThrow("bucket must be a non-empty string");
    await expect(
      deleteRetiredS3CoordinatorObjects({
        bucket: "media/live",
        client: createTestS3DeleteObjectClient(inputs),
        objects: [RETIRED_OBJECT],
      })
    ).rejects.toThrow("bucket must not contain path separators");
    expect(inputs).toEqual([]);
  });

  test("records unsafe S3 retention object keys as failed deletes", async () => {
    const inputs: unknown[] = [];

    const result = await deleteRetiredS3CoordinatorObjects({
      bucket: "media",
      client: createTestS3DeleteObjectClient(inputs),
      objects: [UNSAFE_RETIRED_OBJECT, OK_RETIRED_OBJECT],
    });

    expect(inputs).toEqual([
      {
        Bucket: "media",
        Key: "media/ok.m4s",
      },
    ]);
    expect(result.deletedObjects).toEqual([OK_RETIRED_OBJECT]);
    expect(result.failedObjects).toEqual([
      {
        error: "objectKey must be a safe relative object key",
        object: UNSAFE_RETIRED_OBJECT,
      },
    ]);
  });
});
