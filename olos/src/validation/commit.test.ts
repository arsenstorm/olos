import { describe, expect, test } from "bun:test";

import type { Commit } from "../types/commit";
import { assertCommit, isCommit } from "./commit";

const validCommit: Commit = {
  commitId: "commit_01JZ",
  committedAt: "2026-06-08T12:00:01.820Z",
  deliveryUrl:
    "https://media.example.com/media/tenant/sess/e1/v1080/s3812/p3.m4s",
  duration: 0.5,
  epoch: 1,
  etag: '"9b2cf535f27731c974343645a3985328"',
  independent: false,
  mediaSequenceNumber: 3812,
  objectKey: "media/tenant/sess/e1/v1080/s3812/p3.m4s",
  partNumber: 3,
  programDateTime: "2026-06-08T12:00:05.500Z",
  renditionId: "v1080",
  sessionId: "sess_01JZLIVE",
  size: 312_500,
  slotId: "slot_01JZ",
};

describe("commit validation", () => {
  test("accepts a valid commit", () => {
    expect(isCommit(validCommit)).toBe(true);
    expect(() => assertCommit(validCommit)).not.toThrow();
  });

  test("accepts commits without optional fields", () => {
    const { etag, independent, partNumber, programDateTime, ...commit } =
      validCommit;

    expect(etag).toBeDefined();
    expect(independent).toBe(false);
    expect(partNumber).toBe(3);
    expect(programDateTime).toBeDefined();
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
    expect(() =>
      assertCommit({ ...validCommit, mediaSequenceNumber: -1 })
    ).toThrow("commit.mediaSequenceNumber must be a non-negative integer");
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

  test("rejects invalid size and duration", () => {
    expect(() => assertCommit({ ...validCommit, size: 0 })).toThrow(
      "commit.size must be a positive number"
    );
    expect(() => assertCommit({ ...validCommit, duration: 0 })).toThrow(
      "commit.duration must be a positive number"
    );
  });

  test("rejects invalid timestamps", () => {
    expect(() => assertCommit({ ...validCommit, committedAt: "soon" })).toThrow(
      "commit.committedAt must be a valid timestamp"
    );
    expect(() =>
      assertCommit({ ...validCommit, programDateTime: "soon" })
    ).toThrow("commit.programDateTime must be a valid timestamp");
  });

  test("rejects invalid optional fields", () => {
    expect(() =>
      assertCommit({ ...validCommit, independent: "false" })
    ).toThrow("commit.independent must be a boolean");
    expect(() => assertCommit({ ...validCommit, etag: 123 })).toThrow(
      "commit.etag must be a non-empty string"
    );
    expect(() => assertCommit({ ...validCommit, etag: "" })).toThrow(
      "commit.etag must be a non-empty string"
    );
  });
});
