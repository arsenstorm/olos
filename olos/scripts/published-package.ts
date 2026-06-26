const SEMVER_VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const UNPUBLISHED_PLACEHOLDER_VERSION = "0.0.0";

export function assertPublishedPackageVersion(version: string): void {
  if (isUnpublishedPlaceholderVersion(version)) {
    throw new Error(
      "published package verification requires a released version"
    );
  }

  if (!isSemanticPackageVersion(version)) {
    throw new Error(
      "published package verification requires a semantic version"
    );
  }
}

function isUnpublishedPlaceholderVersion(version: string): boolean {
  return version === UNPUBLISHED_PLACEHOLDER_VERSION;
}

function isSemanticPackageVersion(version: string): boolean {
  return SEMVER_VERSION_PATTERN.test(version);
}
