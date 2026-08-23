import { describe, expect, test } from "bun:test";
import { assertSafeObjectKey } from "../validation/object-key";
import {
  createPublisherDeliveryUrl,
  createPublisherObjectKey,
} from "./object-key-derivation";

describe("createPublisherObjectKey", () => {
  test("derives nonce-less keys for every kind with defaults", () => {
    expect(
      createPublisherObjectKey({
        kind: "init",
        sequenceNumber: 0,
        trackId: "v1080",
      })
    ).toBe("objects/v1080/init");
    expect(
      createPublisherObjectKey({
        kind: "segment",
        sequenceNumber: 3810,
        trackId: "v1080",
      })
    ).toBe("objects/v1080/s3810");
    expect(
      createPublisherObjectKey({
        kind: "part",
        partNumber: 2,
        sequenceNumber: 3810,
        trackId: "v1080",
      })
    ).toBe("objects/v1080/s3810/p2");
  });

  test("derives nonce-bearing keys as dash suffixes for every kind", () => {
    expect(
      createPublisherObjectKey({
        kind: "init",
        objectKeyNonce: "slot_01JZ",
        sequenceNumber: 0,
        trackId: "v1080",
      })
    ).toBe("objects/v1080/init-slot_01JZ");
    expect(
      createPublisherObjectKey({
        kind: "segment",
        objectKeyNonce: "slot_01K0",
        sequenceNumber: 3810,
        trackId: "v1080",
      })
    ).toBe("objects/v1080/s3810-slot_01K0");
    expect(
      createPublisherObjectKey({
        kind: "part",
        objectKeyNonce: "slot_01K1",
        partNumber: 2,
        sequenceNumber: 3810,
        trackId: "v1080",
      })
    ).toBe("objects/v1080/s3810/p2-slot_01K1");
  });

  test("trims outer slashes from custom object key prefixes", () => {
    expect(
      createPublisherObjectKey({
        kind: "segment",
        objectKeyPrefix: "/live/session_1/",
        sequenceNumber: 3810,
        trackId: "v1080",
      })
    ).toBe("live/session_1/v1080/s3810");
    expect(
      createPublisherObjectKey({
        kind: "init",
        objectKeyNonce: "slot_01JZ",
        objectKeyPrefix: "///media//session_1///",
        sequenceNumber: 0,
        trackId: "v1080",
      })
    ).toBe("media//session_1/v1080/init-slot_01JZ");
  });

  test("applies custom extensions and strips leading dots", () => {
    expect(
      createPublisherObjectKey({
        extension: "cmfv",
        kind: "segment",
        sequenceNumber: 3810,
        trackId: "v1080",
      })
    ).toBe("objects/v1080/s3810.cmfv");
    expect(
      createPublisherObjectKey({
        extension: ".cmfv",
        kind: "init",
        objectKeyNonce: "slot_01JZ",
        sequenceNumber: 0,
        trackId: "v1080",
      })
    ).toBe("objects/v1080/init-slot_01JZ.cmfv");
    expect(
      createPublisherObjectKey({
        extension: "..cmfv",
        kind: "part",
        objectKeyNonce: "slot_01K1",
        partNumber: 4,
        sequenceNumber: 3810,
        trackId: "v1080",
      })
    ).toBe("objects/v1080/s3810/p4-slot_01K1.cmfv");
  });

  test("requires partNumber for part keys", () => {
    expect(() =>
      createPublisherObjectKey({
        kind: "part",
        sequenceNumber: 3810,
        trackId: "v1080",
      })
    ).toThrow('partNumber is required when kind is "part"');
  });

  test("derives path-safe object keys for every kind and nonce combination", () => {
    const kinds = [
      { kind: "init", partNumber: undefined },
      { kind: "segment", partNumber: undefined },
      { kind: "part", partNumber: 1 },
    ] as const;

    for (const { kind, partNumber } of kinds) {
      for (const objectKeyNonce of [undefined, "slot_01JZ"]) {
        const objectKey = createPublisherObjectKey({
          kind,
          sequenceNumber: 3810,
          trackId: "v1080",
          ...(objectKeyNonce === undefined ? {} : { objectKeyNonce }),
          ...(partNumber === undefined ? {} : { partNumber }),
        });

        expect(() => assertSafeObjectKey(objectKey, "objectKey")).not.toThrow();
      }
    }
  });

  test("derived keys with traversal inputs fail object key safety validation", () => {
    const traversal = createPublisherObjectKey({
      kind: "segment",
      sequenceNumber: 3810,
      trackId: "..",
    });

    expect(() => assertSafeObjectKey(traversal, "objectKey")).toThrow();
  });
});

describe("createPublisherDeliveryUrl", () => {
  test("joins the object key onto the base URL path", () => {
    expect(
      createPublisherDeliveryUrl(
        "https://media.example.com",
        "media/v1080/s3810.m4s"
      )
    ).toBe("https://media.example.com/media/v1080/s3810.m4s");
    expect(
      createPublisherDeliveryUrl(
        "https://media.example.com/live/",
        "objects/v1080/s3810-slot_01K0"
      )
    ).toBe("https://media.example.com/live/objects/v1080/s3810-slot_01K0");
  });

  test("drops query strings and fragments from the base URL", () => {
    expect(
      createPublisherDeliveryUrl(
        "https://media.example.com/live?token=abc#frag",
        "objects/v1080/init"
      )
    ).toBe("https://media.example.com/live/objects/v1080/init");
  });

  test("rejects non-HTTP base URLs", () => {
    expect(() =>
      createPublisherDeliveryUrl("ftp://media.example.com", "media/init.mp4")
    ).toThrow("baseUrl must be an absolute HTTP(S) URL");
    expect(() =>
      createPublisherDeliveryUrl("not-a-url", "media/init.mp4")
    ).toThrow("baseUrl must be an absolute HTTP(S) URL");
  });
});
