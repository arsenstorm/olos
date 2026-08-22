import { describe, expect, test } from "bun:test";
import { formatFrameRate, formatSeconds, quotedPlaylistValue } from "./format";

describe("HLS formatting helpers", () => {
  test("passes quoted-string values through verbatim, including backslashes", () => {
    expect(quotedPlaylistValue("avc1.4d401f,mp4a.40.2", "codecs")).toBe(
      "avc1.4d401f,mp4a.40.2"
    );
    expect(quotedPlaylistValue("media\\odd\\path.m4s", "uri")).toBe(
      "media\\odd\\path.m4s"
    );
  });

  test("rejects values a quoted-string cannot represent", () => {
    expect(() =>
      quotedPlaylistValue('English "director cut"', "track name")
    ).toThrow("track name must not contain double quotes or line breaks");
    expect(() => quotedPlaylistValue("line\rreturn", "track name")).toThrow(
      "track name must not contain double quotes or line breaks"
    );
    expect(() => quotedPlaylistValue("line\nfeed", "track name")).toThrow(
      "track name must not contain double quotes or line breaks"
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
