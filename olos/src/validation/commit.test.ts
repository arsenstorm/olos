import { describe, expect, test } from "bun:test";

import type { Commit } from "../types/commit";
import { assertCommit, isCommit, parseCommit } from "./commit";

const validCommit: Commit = {
  commitId: "commit_01JZ",
  committedAt: "2026-06-08T12:00:01.820Z",
  deliveryUrl:
    "https://media.example.com/media/tenant/sess/e1/v1080/s3812/p3.m4s",
  epoch: 1,
  etag: '"9b2cf535f27731c974343645a3985328"',
  objectKey: "media/tenant/sess/e1/v1080/s3812/p3.m4s",
  partNumber: 3,
  profile: {
    duration: 0.5,
    independent: false,
    programDateTime: "2026-06-08T12:00:05.500Z",
  },
  sequenceNumber: 3812,
  sessionId: "sess_01JZLIVE",
  size: 312_500,
  slotId: "slot_01JZ",
  trackId: "v1080",
};

describe("commit validation", () => {
  test("accepts a valid commit", () => {
    expect(isCommit(validCommit)).toBe(true);
    expect(() => assertCommit(validCommit)).not.toThrow();
  });

  test("accepts commits without optional fields", () => {
    const { etag, profile, partNumber, ...commit } = validCommit;

    expect(etag).toBeDefined();
    expect(profile).toBeDefined();
    expect(partNumber).toBe(3);
    expect(() => assertCommit(commit)).not.toThrow();
  });

  test("rejects non-object values", () => {
    expect(isCommit(null)).toBe(false);
    expect(() => assertCommit(null)).toThrow("commit must be an object");
  });

  test("rejects unsafe identifiers", () => {
    expect(() =>
      assertCommit({ ...validCommit, commitId: "../secret" })
    ).toThrow("commit.commitId must be a non-empty URL-safe identifier");
  });

  test("rejects invalid sequence numbers", () => {
    expect(() => assertCommit({ ...validCommit, sequenceNumber: -1 })).toThrow(
      "commit.sequenceNumber must be a non-negative integer"
    );
    expect(() => assertCommit({ ...validCommit, partNumber: -1 })).toThrow(
      "commit.partNumber must be a non-negative integer"
    );
  });

  test("rejects unsafe object keys", () => {
    expect(() =>
      assertCommit({ ...validCommit, objectKey: "media/../secret.m4s" })
    ).toThrow("commit.objectKey must be a safe relative object key");
    expect(() =>
      assertCommit({ ...validCommit, objectKey: "media/key.m4s\n" })
    ).toThrow("commit.objectKey must not contain control characters");
  });

  test("rejects unsafe delivery URLs", () => {
    expect(() =>
      assertCommit({ ...validCommit, deliveryUrl: "media/key.m4s" })
    ).toThrow(
      "commit.deliveryUrl must be an absolute HTTP(S) URL or safe relative path"
    );
    expect(() =>
      assertCommit({ ...validCommit, deliveryUrl: "javascript:alert(1)" })
    ).toThrow(
      "commit.deliveryUrl must be an absolute HTTP(S) URL or safe relative path"
    );
    expect(() =>
      assertCommit({
        ...validCommit,
        deliveryUrl: "https://media.example.com/key.m4s?token=abc",
      })
    ).toThrow("commit.deliveryUrl must not contain query strings or fragments");
    expect(() =>
      assertCommit({ ...validCommit, deliveryUrl: "/media/key.m4s#x" })
    ).toThrow("commit.deliveryUrl must not contain query strings or fragments");
    expect(() =>
      assertCommit({
        ...validCommit,
        deliveryUrl: "/media/key.m4s\n#EXT-X-ENDLIST",
      })
    ).toThrow("commit.deliveryUrl must not contain control characters");
    expect(() =>
      assertCommit({ ...validCommit, deliveryUrl: "/media/../key.m4s" })
    ).toThrow(
      "commit.deliveryUrl must be an absolute HTTP(S) URL or safe relative path"
    );
    expect(() =>
      assertCommit({ ...validCommit, deliveryUrl: "/media//key.m4s" })
    ).toThrow(
      "commit.deliveryUrl must be an absolute HTTP(S) URL or safe relative path"
    );
  });

  test("rejects invalid sizes", () => {
    expect(() => assertCommit({ ...validCommit, size: 0 })).toThrow(
      "commit.size must be a positive integer"
    );
    expect(() => assertCommit({ ...validCommit, size: 312.5 })).toThrow(
      "commit.size must be a positive integer"
    );
  });

  test("rejects invalid timestamps", () => {
    expect(() => assertCommit({ ...validCommit, committedAt: "soon" })).toThrow(
      "commit.committedAt must be a valid timestamp"
    );
  });

  test("rejects invalid optional fields", () => {
    expect(() => assertCommit({ ...validCommit, profile: "part" })).toThrow(
      "commit.profile must be an object"
    );
    expect(() =>
      assertCommit({ ...validCommit, profile: { anything: [], duration: 0 } })
    ).not.toThrow();
    expect(() => assertCommit({ ...validCommit, etag: 123 })).toThrow(
      "commit.etag must be a non-empty string"
    );
    expect(() => assertCommit({ ...validCommit, etag: "" })).toThrow(
      "commit.etag must be a non-empty string"
    );
  });
});

describe("tolerant commit parsing", () => {
  const commitWithByterange: Commit = {
    ...validCommit,
    byterange: {
      length: 12_500,
      offset: 0,
      segmentDeliveryUrl:
        "https://media.example.com/media/tenant/sess/e1/v1080/s3812.m4s",
      segmentObjectKey: "media/tenant/sess/e1/v1080/s3812.m4s",
    },
  };

  test("strips unknown fields and returns a fresh commit", () => {
    const parsed = parseCommit({ ...validCommit, extra: 1 });

    expect(parsed).toEqual(validCommit);
    expect(parsed).not.toBe(validCommit);
  });

  test("strips unknown fields inside the byterange", () => {
    const parsed = parseCommit({
      ...commitWithByterange,
      byterange: { ...commitWithByterange.byterange, extra: 1 },
    });

    expect(parsed).toEqual(commitWithByterange);
  });

  test("still rejects invalid known fields", () => {
    expect(() => parseCommit({ ...validCommit, extra: 1, size: 0 })).toThrow(
      "commit.size"
    );
  });
});
