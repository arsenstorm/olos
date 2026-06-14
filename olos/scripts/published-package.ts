const SEMVER_VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function assertPublishedPackageVersion(version: string): void {
  if (version === "0.0.0") {
    throw new Error(
      "published package verification requires a released version"
    );
  }

  if (!SEMVER_VERSION_PATTERN.test(version)) {
    throw new Error(
      "published package verification requires a semantic version"
    );
  }
}
