import { describe, expect, test } from "bun:test";

import { createCoordinatorStateWithIssuedSegment } from "../protocol/coordinator-state.test-helper";
import { commitCoordinatorUploadFromRequest } from "./commit";
import { rawOrJsonPostRequest } from "./test-http.test-helper";
import {
  assertInvalidResult,
  invalidResultMessage,
} from "./test-result.test-helper";

describe("runtime commit adapter", () => {
  test("commits an upload from a JSON request", async () => {
    const result = await commitCoordinatorUploadFromRequest({
      request: commitRequest(commitPayload()),
      state: createCoordinatorStateWithIssuedSegment(),
    });

    expect(result.status).toBe("committed");

    if (result.status !== "committed") {
      throw new Error("expected committed upload");
    }

    expect(result.response.status).toBe(201);
    expect(result.state.commits).toHaveLength(1);
    expect(result.state.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(await result.response.json()).toMatchObject({
      commit: { commitId: "commit_3810" },
    });
  });

  test("commits an upload from a direct payload object", async () => {
    const result = await commitCoordinatorUploadFromRequest({
      request: commitPayload(),
      state: createCoordinatorStateWithIssuedSegment(),
    });

    expect(result.status).toBe("committed");

    if (result.status !== "committed") {
      throw new Error("expected committed upload");
    }

    expect(result.response.status).toBe(201);
    expect(result.state.commits).toHaveLength(1);
    expect(result.state.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(await result.response.json()).toMatchObject({
      commit: { commitId: "commit_3810" },
    });
  });

  test("returns invalid responses for malformed JSON requests", async () => {
    const result = await commitCoordinatorUploadFromRequest({
      request: commitRequest("{"),
      state: createCoordinatorStateWithIssuedSegment(),
    });

    assertInvalidResult(result);
  });

  test("returns invalid responses for unsafe JSON object keys", async () => {
    for (const objectKey of [
      "media/../secret.m4s",
      "https://publisher.example.net/injected.m4s",
    ]) {
      const result = await commitCoordinatorUploadFromRequest({
        request: commitRequest({
          ...commitPayload(),
          object: {
            ...commitPayload().object,
            objectKey,
          },
        }),
        state: createCoordinatorStateWithIssuedSegment(),
      });

      expect(invalidResultMessage(result)).toBe(
        "object.objectKey must be a safe relative object key"
      );
    }
  });

  test("returns invalid responses for unsafe JSON identifiers", async () => {
    const cases = [
      {
        expected: "commitId must be a non-empty URL-safe identifier",
        payload: { ...commitPayload(), commitId: "../commit" },
      },
      {
        expected: "slotId must be a non-empty URL-safe identifier",
        payload: { ...commitPayload(), slotId: "../slot" },
      },
      {
        expected: "providerId must be a non-empty URL-safe identifier",
        payload: {
          ...commitPayload(),
          object: {
            ...commitPayload().object,
            providerId: "../provider",
          },
        },
      },
    ] as const;

    for (const testCase of cases) {
      const result = await commitCoordinatorUploadFromRequest({
        request: commitRequest(testCase.payload),
        state: createCoordinatorStateWithIssuedSegment(),
      });

      expect(invalidResultMessage(result)).toBe(testCase.expected);
    }
  });

  test("returns invalid responses for non-positive object sizes", async () => {
    const result = await commitCoordinatorUploadFromRequest({
      request: commitRequest({
        ...commitPayload(),
        object: {
          ...commitPayload().object,
          size: 0,
        },
      }),
      state: createCoordinatorStateWithIssuedSegment(),
    });

    expect(invalidResultMessage(result)).toBe("size must be a positive number");
  });

  test("returns invalid responses for invalid max segment limits", async () => {
    const result = await commitCoordinatorUploadFromRequest({
      request: commitRequest({
        ...commitPayload(),
        maxSegments: 0,
      }),
      state: createCoordinatorStateWithIssuedSegment(),
    });

    expect(invalidResultMessage(result)).toBe(
      "maxSegments must be a positive integer"
    );
  });

  test("returns invalid responses for invalid late tolerance", async () => {
    const result = await commitCoordinatorUploadFromRequest({
      request: commitRequest({
        ...commitPayload(),
        lateToleranceMs: -1,
      }),
      state: createCoordinatorStateWithIssuedSegment(),
    });

    expect(invalidResultMessage(result)).toBe(
      "lateToleranceMs must be a non-negative number"
    );
  });

  test("returns invalid responses for invalid JSON timestamps", async () => {
    const cases = [
      {
        expected: "committedAt must be a valid timestamp",
        payload: {
          ...commitPayload(),
          committedAt: "soon",
        },
      },
      {
        expected: "observedAt must be a valid timestamp",
        payload: {
          ...commitPayload(),
          object: {
            ...commitPayload().object,
            observedAt: "soon",
          },
        },
      },
      {
        expected: "programDateTime must be a valid timestamp",
        payload: {
          ...commitPayload(),
          programDateTime: "soon",
        },
      },
    ] as const;

    for (const testCase of cases) {
      const result = await commitCoordinatorUploadFromRequest({
        request: commitRequest(testCase.payload),
        state: createCoordinatorStateWithIssuedSegment(),
      });

      expect(invalidResultMessage(result)).toBe(testCase.expected);
    }
  });

  test("returns protocol rejection responses", async () => {
    const result = await commitCoordinatorUploadFromRequest({
      request: {
        ...commitPayload(),
        slotId: "missing",
      },
      state: createCoordinatorStateWithIssuedSegment(),
    });

    expect(result.status).toBe("rejected");

    if (result.status !== "rejected") {
      throw new Error("expected rejected upload");
    }

    expect(result.error.error.code).toBe("olos.unknown_slot");
    expect(result.response.status).toBe(404);
  });
});

function commitPayload() {
  return {
    commitId: "commit_3810",
    committedAt: "2026-01-01T00:00:02.000Z",
    independent: true,
    object: {
      contentType: "video/mp4",
      objectKey: "media/s3810.m4s",
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      size: 98_304,
    },
    slotId: "slot_3810",
  };
}

function commitRequest(body: string | unknown): Request {
  return rawOrJsonPostRequest(
    "https://edge.example.com/v1/live/session_1/commit",
    body
  );
}
