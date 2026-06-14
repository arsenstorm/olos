export function assertS3BucketName(value: string): void {
  if (value.length === 0) {
    throw new Error("bucket must be a non-empty string");
  }

  if (value.includes("/")) {
    throw new Error("bucket must not contain path separators");
  }
}
