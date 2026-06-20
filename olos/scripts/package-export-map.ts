const PACKAGE_JSON_EXPORT_SUBPATH = "./package.json";

export function packageExportEntrypoint(subpath: string): string {
  return subpath === "." ? "index" : subpath.slice("./".length);
}

export function packageExportSpecifier(subpath: string): string {
  return subpath === "." ? "olos" : `olos/${packageExportEntrypoint(subpath)}`;
}

export function packageExportSubpaths(
  exportsMap: Record<string, unknown>
): string[] {
  return Object.keys(exportsMap).filter(
    (subpath) => subpath !== PACKAGE_JSON_EXPORT_SUBPATH
  );
}
