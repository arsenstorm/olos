import { describe, expect, test } from "bun:test";
import type { UploadSlot } from "../types/upload-slot";
import { invalidStringMapFixture } from "../validation/test-string-map.test-helper";
import { createUploadGrant } from "./upload-grant";

const slot: UploadSlot = {
  contentType: "video/mp4",
  deliveryUrl: "/objects/tenant/session/v1080/3810.m4s",
  duration: 2,
  epoch: 0,
  expiresAt: "2026-01-01T00:00:05.000Z",
  kind: "segment",
  maxBytes: 100_000,
  mediaSequenceNumber: 3810,
  objectKey: "tenant/session/v1080/3810.m4s",
  publicationMode: "direct-public",
  publisherInstanceId: "pub_1",
  renditionId: "v1080",
  sessionId: "session_1",
  slotId: "slot_1",
  state: "issued",
  tenantId: "tenant_1",
};

describe("upload grant builder", () => {
  test("creates a PUT grant from an issued upload slot", () => {
    expect(
      createUploadGrant({
        slot,
        url: "https://storage.example.com/upload/signed",
      })
    ).toEqual({
      expiresAt: "2026-01-01T00:00:05.000Z",
      method: "PUT",
      requiredHeaders: {
        "Content-Type": "video/mp4",
        "If-None-Match": "*",
        "x-olos-slot-id": "slot_1",
      },
      slotId: "slot_1",
      url: "https://storage.example.com/upload/signed",
    });
  });

  test("supports shorter grant expiry and provider headers", () => {
    expect(
      createUploadGrant({
        additionalHeaders: {
          "x-provider-checksum": "sha256:abc123",
        },
        expiresAt: "2026-01-01T00:00:03.000Z",
        slot,
        url: "https://storage.example.com/upload/signed",
      })
    ).toMatchObject({
      expiresAt: "2026-01-01T00:00:03.000Z",
      requiredHeaders: {
        "Content-Type": "video/mp4",
        "If-None-Match": "*",
        "x-olos-slot-id": "slot_1",
        "x-provider-checksum": "sha256:abc123",
      },
    });
  });

  test("allows explicit grant expiry equal to the slot expiry", () => {
    expect(
      createUploadGrant({
        expiresAt: slot.expiresAt,
        slot,
        url: "https://storage.example.com/upload/signed",
      }).expiresAt
    ).toBe(slot.expiresAt);
  });

  test("rejects slots that are not issued", () => {
    expect(() =>
      createUploadGrant({
        slot: { ...slot, state: "upload_observed" },
        url: "https://storage.example.com/upload/signed",
      })
    ).toThrow("uploadSlot.state must be issued");
  });

  test("rejects grants that outlive the slot", () => {
    expect(() =>
      createUploadGrant({
        expiresAt: "2026-01-01T00:00:06.000Z",
        slot,
        url: "https://storage.example.com/upload/signed",
      })
    ).toThrow(
      "uploadGrant.expiresAt must be before or equal to uploadSlot.expiresAt"
    );
  });

  test("rejects additional headers that override OLOS headers", () => {
    expect(() =>
      createUploadGrant({
        additionalHeaders: {
          "content-type": "application/octet-stream",
        },
        slot,
        url: "https://storage.example.com/upload/signed",
      })
    ).toThrow("additionalHeaders must not override content-type");
    expect(() =>
      createUploadGrant({
        additionalHeaders: {
          "IF-NONE-MATCH": "etag",
        },
        slot,
        url: "https://storage.example.com/upload/signed",
      })
    ).toThrow("additionalHeaders must not override IF-NONE-MATCH");
  });

  test("rejects malformed additional headers", () => {
    expect(() =>
      createUploadGrant({
        additionalHeaders: invalidStringMapFixture(null),
        slot,
        url: "https://storage.example.com/upload/signed",
      })
    ).toThrow("additionalHeaders must be a string map");
    expect(() =>
      createUploadGrant({
        additionalHeaders: invalidStringMapFixture({
          "x-provider-checksum": 123,
        }),
        slot,
        url: "https://storage.example.com/upload/signed",
      })
    ).toThrow("additionalHeaders must be a string map");
    expect(() =>
      createUploadGrant({
        additionalHeaders: {
          "bad header": "sha256:abc123",
        },
        slot,
        url: "https://storage.example.com/upload/signed",
      })
    ).toThrow("additionalHeaders must be a string map");
  });

  test("rejects non-HTTP upload URLs", () => {
    expect(() =>
      createUploadGrant({
        slot,
        url: "r2://bucket/key",
      })
    ).toThrow("uploadGrant.url must be an absolute HTTP(S) URL");
  });
});
