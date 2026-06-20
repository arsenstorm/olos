import { pathToFileURL } from "node:url";

export function isCliEntry(
  moduleUrl: string,
  entry = process.argv[1]
): boolean {
  return entry !== undefined && moduleUrl === pathToFileURL(entry).href;
}
