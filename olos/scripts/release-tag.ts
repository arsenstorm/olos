export function assertReleaseTag(
  tag: string | undefined,
  expected: string
): void {
  if (tag !== expected) {
    throw new Error(`release tag must be ${expected}`);
  }
}
