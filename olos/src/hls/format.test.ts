import { describe, expect, test } from "bun:test";
import { escapePlaylistValue, formatFrameRate, formatSeconds } from "./format";

describe("HLS formatting helpers", () => {
  test("escapes playlist quoted-string values", () => {
    expect(escapePlaylistValue('avc1.4d401f,"quoted"\\path')).toBe(
      'avc1.4d401f,\\"quoted\\"\\\\path'
    );
  });

  test("formats seconds with millisecond precision", () => {
    expect(formatSeconds(2)).toBe("2.000");
    expect(formatSeconds(2.3456)).toBe("2.346");
  });

  test("formats integer and fractional frame rates", () => {
    expect(formatFrameRate(30)).toBe("30");
    expect(formatFrameRate(29.970_03)).toBe("29.970");
  });
});
