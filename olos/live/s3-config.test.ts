import { describe, expect, test } from "vitest";
import { type LiveS3Env, readLiveS3ConfigFromEnv } from "./s3-config";

const requiredEnv = {
  OLOS_LIVE_S3: "1",
  OLOS_LIVE_S3_ACCESS_KEY_ID: "access",
  OLOS_LIVE_S3_BUCKET: "media",
  OLOS_LIVE_S3_REGION: "auto",
  OLOS_LIVE_S3_SECRET_ACCESS_KEY: "secret",
} satisfies LiveS3Env;

describe("live S3 config", () => {
  test("is disabled unless explicitly enabled", () => {
    expect(readLiveS3ConfigFromEnv({})).toEqual({ status: "disabled" });
    expect(readLiveS3ConfigFromEnv({ OLOS_LIVE_S3: "true" })).toEqual({
      status: "disabled",
    });
  });

  test("reads required values and defaults", () => {
    expect(readLiveS3ConfigFromEnv(requiredEnv)).toEqual({
      accessKeyId: "access",
      bucket: "media",
      forcePathStyle: false,
      prefix: "olos-live-s3",
      region: "auto",
      secretAccessKey: "secret",
      status: "enabled",
    });
  });

  test("defaults path-style access when a custom endpoint is set", () => {
    expect(
      readLiveS3ConfigFromEnv({
        ...requiredEnv,
        OLOS_LIVE_S3_ENDPOINT: "https://s3.example.com",
      })
    ).toMatchObject({
      endpoint: "https://s3.example.com",
      forcePathStyle: true,
    });
  });

  test.each([
    ["true", true],
    ["false", false],
    ["1", true],
    ["0", false],
  ])("reads force path style value %s", (value, expected) => {
    expect(
      readLiveS3ConfigFromEnv({
        ...requiredEnv,
        OLOS_LIVE_S3_FORCE_PATH_STYLE: value,
      })
    ).toMatchObject({ forcePathStyle: expected });
  });

  test("rejects invalid force path style values", () => {
    expect(() =>
      readLiveS3ConfigFromEnv({
        ...requiredEnv,
        OLOS_LIVE_S3_FORCE_PATH_STYLE: "yes",
      })
    ).toThrow("OLOS_LIVE_S3_FORCE_PATH_STYLE must be true, false, 1, or 0");
  });

  test("reports every missing required value", () => {
    expect(() => readLiveS3ConfigFromEnv({ OLOS_LIVE_S3: "1" })).toThrow(
      "Missing required live S3 env when OLOS_LIVE_S3=1: OLOS_LIVE_S3_ACCESS_KEY_ID, OLOS_LIVE_S3_BUCKET, OLOS_LIVE_S3_REGION, OLOS_LIVE_S3_SECRET_ACCESS_KEY"
    );
  });

  test.each([
    "/",
    "media//bad",
    "media/../bad",
    "media?x=1",
    "media#x",
  ])("rejects unsafe prefix %s", (prefix) => {
    expect(() =>
      readLiveS3ConfigFromEnv({
        ...requiredEnv,
        OLOS_LIVE_S3_PREFIX: prefix,
      })
    ).toThrow("OLOS_LIVE_S3_PREFIX must be a safe relative object prefix");
  });

  test("rejects control characters in prefixes", () => {
    expect(() =>
      readLiveS3ConfigFromEnv({
        ...requiredEnv,
        OLOS_LIVE_S3_PREFIX: "media/\u0001bad",
      })
    ).toThrow("OLOS_LIVE_S3_PREFIX must be a safe relative object prefix");
  });

  test("trims leading and trailing slashes from safe prefixes", () => {
    expect(
      readLiveS3ConfigFromEnv({
        ...requiredEnv,
        OLOS_LIVE_S3_PREFIX: "/media/live/",
      })
    ).toMatchObject({ prefix: "media/live" });
  });
});
