import { describe, expect, test } from "bun:test";
import { assertS3BucketName } from "./bucket";

describe("S3 bucket validation", () => {
  test("accepts non-empty bucket names without path separators", () => {
    expect(() => assertS3BucketName("media-bucket")).not.toThrow();
  });

  test("rejects empty bucket names", () => {
    expect(() => assertS3BucketName("")).toThrow(
      "bucket must be a non-empty string"
    );
  });

  test("rejects path separators", () => {
    expect(() => assertS3BucketName("media/bucket")).toThrow(
      "bucket must not contain path separators"
    );
    expect(() => assertS3BucketName("/media-bucket")).toThrow(
      "bucket must not contain path separators"
    );
  });
});
