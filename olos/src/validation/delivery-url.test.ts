import { describe, expect, test } from "bun:test";
import { assertSafeDeliveryUrl } from "./delivery-url";

const acceptedDeliveryUrlCases = [
  {
    label: "absolute HTTP URL",
    value: "https://media.example.com/live/3810.m4s",
  },
  {
    label: "safe relative path",
    value: "/live/session/v1080/3810.m4s",
  },
] as const;

const rejectedDeliveryUrlCases = [
  {
    error: "url must be a non-empty string",
    label: "empty values",
    value: "",
  },
  {
    error: "url must not contain control characters",
    label: "control characters",
    value: "bad\nurl",
  },
  {
    error: "url must not contain query strings or fragments",
    label: "query strings",
    value: "/live/3810.m4s?token=1",
  },
  {
    error: "url must be an absolute HTTP(S) URL or safe relative path",
    label: "parent directory segments",
    value: "/live/../secret.m4s",
  },
  {
    error: "url must be an absolute HTTP(S) URL or safe relative path",
    label: "repeated slashes",
    value: "/live//3810.m4s",
  },
  {
    error: "url must be an absolute HTTP(S) URL or safe relative path",
    label: "protocol-relative URLs",
    value: "//cdn.example.com/live.m4s",
  },
  {
    error: "url must be an absolute HTTP(S) URL or safe relative path",
    label: "non-HTTP schemes",
    value: "s3://bucket/key",
  },
] as const;

describe("delivery URL validation", () => {
  for (const deliveryUrl of acceptedDeliveryUrlCases) {
    test(`accepts ${deliveryUrl.label}`, () => {
      expect(() =>
        assertSafeDeliveryUrl(deliveryUrl.value, "url")
      ).not.toThrow();
    });
  }

  for (const deliveryUrl of rejectedDeliveryUrlCases) {
    test(`rejects ${deliveryUrl.label}`, () => {
      expect(() => assertSafeDeliveryUrl(deliveryUrl.value, "url")).toThrow(
        deliveryUrl.error
      );
    });
  }
});
