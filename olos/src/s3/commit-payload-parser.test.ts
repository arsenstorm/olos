import { describe, expect, test } from "bun:test";

import { parseCommitTimestamp } from "../runtime/commit-payload-parser";
import {
  parseS3CommitPayload,
  parseS3ReconciliationPayload,
  parseS3ReconciliationPayloadRequest,
} from "./commit-payload-parser";

describe("S3 commit payload parser", () => {
  test("parses shared S3 commit payloads", () => {
    expect(
      parseS3CommitPayload(
        {
          commitId: "commit_3810",
          committedAt: "2026-01-01T00:00:02.000Z",
          objectKey: "live/session/3810.m4s",
          profile: { independent: true },
          slotId: "slot_3810",
          versionId: "v1",
        },
        { providerId: "provider_1" }
      )
    ).toMatchObject({
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      objectKey: "live/session/3810.m4s",
      profile: { independent: true },
      providerId: "provider_1",
      slotId: "slot_3810",
      versionId: "v1",
    });
  });

  test("accepts custom committedAt parsing for shared S3 commit helpers", () => {
    expect(
      parseS3CommitPayload(
        {
          commitId: "commit_3810",
          objectKey: "live/session/3810.m4s",
          slotId: "slot_3810",
        },
        { providerId: "provider_1" },
        () => "2026-01-01T00:00:02.000Z"
      )
    ).toMatchObject({
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      providerId: "provider_1",
      slotId: "slot_3810",
    });
  });

  test("applies S3 commit id overrides before reading payload identifiers", () => {
    expect(
      parseS3CommitPayload(
        {
          committedAt: "2026-01-01T00:00:02.000Z",
          versionId: "v1",
        },
        { providerId: "provider_1" },
        parseCommitTimestamp,
        {
          commitId: "commit_override",
          slotId: "slot_override",
        }
      )
    ).toEqual({
      commitId: "commit_override",
      committedAt: "2026-01-01T00:00:02.000Z",
      providerId: "provider_1",
      slotId: "slot_override",
      versionId: "v1",
    });
  });

  test("parses shared S3 reconciliation payloads", () => {
    expect(
      parseS3ReconciliationPayload(
        {
          committedAt: "2026-01-01T00:00:02.000Z",
          profile: { independent: true },
          slotIds: ["slot_init", "slot_3810"],
          versionId: "v1",
        },
        {
          providerId: "provider_fallback",
        }
      )
    ).toMatchObject({
      committedAt: "2026-01-01T00:00:02.000Z",
      profile: { independent: true },
      providerId: "provider_fallback",
      slotIds: ["slot_init", "slot_3810"],
      versionId: "v1",
    });
  });

  test("rejects malformed S3 reconciliation request payloads", async () => {
    await expect(
      parseS3ReconciliationPayloadRequest(
        new Request("https://edge.example.com/s3/reconcile", {
          body: JSON.stringify([]),
          method: "POST",
        }),
        {
          fallbackMessage: "fallback",
          invalid: (message) => ({ message, status: "invalid" as const }),
          provider: { providerId: "provider_fallback" },
        }
      )
    ).resolves.toEqual({
      message: "S3 reconciliation request must be a JSON object",
      status: "invalid",
    });
  });
});
