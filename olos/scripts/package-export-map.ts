const PACKAGE_JSON_EXPORT_SUBPATH = "./package.json";
const PACKAGE_EXPORT_SUBPATH_PREFIX = "./";

export function packageExportEntrypoint(subpath: string): string {
  return subpath === "."
    ? "index"
    : subpath.slice(PACKAGE_EXPORT_SUBPATH_PREFIX.length);
}

export function packageExportSpecifier(subpath: string): string {
  return subpath === "." ? "olos" : `olos/${packageExportEntrypoint(subpath)}`;
}

export function packageExportSubpaths(
  exportsMap: Record<string, unknown>
): string[] {
  return Object.keys(exportsMap).filter(isPackageModuleExportSubpath);
}

function isPackageModuleExportSubpath(subpath: string): boolean {
  return subpath !== PACKAGE_JSON_EXPORT_SUBPATH;
}
