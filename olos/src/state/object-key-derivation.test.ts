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
        mediaSequenceNumber: 0,
        renditionId: "v1080",
      })
    ).toBe("media/v1080/init.mp4");
    expect(
      createPublisherObjectKey({
        kind: "segment",
        mediaSequenceNumber: 3810,
        renditionId: "v1080",
      })
    ).toBe("media/v1080/s3810.m4s");
    expect(
      createPublisherObjectKey({
        kind: "part",
        mediaSequenceNumber: 3810,
        partNumber: 2,
        renditionId: "v1080",
      })
    ).toBe("media/v1080/s3810/p2.m4s");
  });

  test("derives nonce-bearing keys as dash suffixes for every kind", () => {
    expect(
      createPublisherObjectKey({
        kind: "init",
        mediaSequenceNumber: 0,
        objectKeyNonce: "slot_01JZ",
        renditionId: "v1080",
      })
    ).toBe("media/v1080/init-slot_01JZ.mp4");
    expect(
      createPublisherObjectKey({
        kind: "segment",
        mediaSequenceNumber: 3810,
        objectKeyNonce: "slot_01K0",
        renditionId: "v1080",
      })
    ).toBe("media/v1080/s3810-slot_01K0.m4s");
    expect(
      createPublisherObjectKey({
        kind: "part",
        mediaSequenceNumber: 3810,
        objectKeyNonce: "slot_01K1",
        partNumber: 2,
        renditionId: "v1080",
      })
    ).toBe("media/v1080/s3810/p2-slot_01K1.m4s");
  });

  test("trims outer slashes from custom object key prefixes", () => {
    expect(
      createPublisherObjectKey({
        kind: "segment",
        mediaSequenceNumber: 3810,
        objectKeyPrefix: "/live/session_1/",
        renditionId: "v1080",
      })
    ).toBe("live/session_1/v1080/s3810.m4s");
    expect(
      createPublisherObjectKey({
        kind: "init",
        mediaSequenceNumber: 0,
        objectKeyNonce: "slot_01JZ",
        objectKeyPrefix: "///media//session_1///",
        renditionId: "v1080",
      })
    ).toBe("media//session_1/v1080/init-slot_01JZ.mp4");
  });

  test("applies custom extensions and strips leading dots", () => {
    expect(
      createPublisherObjectKey({
        extension: "cmfv",
        kind: "segment",
        mediaSequenceNumber: 3810,
        renditionId: "v1080",
      })
    ).toBe("media/v1080/s3810.cmfv");
    expect(
      createPublisherObjectKey({
        extension: ".cmfv",
        kind: "init",
        mediaSequenceNumber: 0,
        objectKeyNonce: "slot_01JZ",
        renditionId: "v1080",
      })
    ).toBe("media/v1080/init-slot_01JZ.cmfv");
    expect(
      createPublisherObjectKey({
        extension: "..cmfv",
        kind: "part",
        mediaSequenceNumber: 3810,
        objectKeyNonce: "slot_01K1",
        partNumber: 4,
        renditionId: "v1080",
      })
    ).toBe("media/v1080/s3810/p4-slot_01K1.cmfv");
  });

  test("requires partNumber for part keys", () => {
    expect(() =>
      createPublisherObjectKey({
        kind: "part",
        mediaSequenceNumber: 3810,
        renditionId: "v1080",
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
          mediaSequenceNumber: 3810,
          renditionId: "v1080",
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
      mediaSequenceNumber: 3810,
      renditionId: "..",
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
        "media/v1080/s3810-slot_01K0.m4s"
      )
    ).toBe("https://media.example.com/live/media/v1080/s3810-slot_01K0.m4s");
  });

  test("drops query strings and fragments from the base URL", () => {
    expect(
      createPublisherDeliveryUrl(
        "https://media.example.com/live?token=abc#frag",
        "media/v1080/init.mp4"
      )
    ).toBe("https://media.example.com/live/media/v1080/init.mp4");
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
