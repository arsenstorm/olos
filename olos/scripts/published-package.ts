export function assertPublishedPackageVersion(version: string): void {
  if (version === "0.0.0") {
    throw new Error(
      "published package verification requires a released version"
    );
  }
}
