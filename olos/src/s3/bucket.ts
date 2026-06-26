const BUCKET_EMPTY_MESSAGE = "bucket must be a non-empty string";
const BUCKET_PATH_SEPARATOR = "/";
const BUCKET_PATH_SEPARATOR_MESSAGE = "bucket must not contain path separators";

export function assertS3BucketName(value: string): void {
  if (value.length === 0) {
    throw new Error(BUCKET_EMPTY_MESSAGE);
  }

  if (value.includes(BUCKET_PATH_SEPARATOR)) {
    throw new Error(BUCKET_PATH_SEPARATOR_MESSAGE);
  }
}
