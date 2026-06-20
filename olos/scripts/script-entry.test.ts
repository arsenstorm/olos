import { expect, test } from "bun:test";
import { pathToFileURL } from "node:url";
import { isCliEntry } from "./script-entry";

test("isCliEntry accepts the matching entry path", () => {
  const entry = "/tmp/olos-script.ts";

  expect(isCliEntry(pathToFileURL(entry).href, entry)).toBe(true);
});

test("isCliEntry rejects missing and mismatched entries", () => {
  const entry = "/tmp/olos-script.ts";

  expect(isCliEntry(pathToFileURL(entry).href, undefined)).toBe(false);
  expect(isCliEntry(pathToFileURL(entry).href, "/tmp/other-script.ts")).toBe(
    false
  );
});
