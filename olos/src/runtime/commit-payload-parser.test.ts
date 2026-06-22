import { describe, expect, test } from "bun:test";

import {
  parseCommitRequestPayload,
  parseCommitTimestamp,
  parseCommitTimestampOrNow,
  parseObservedUploadPayload,
  parseOptionalSafeObjectKeyField,
  parseOptionalUrlSafeIdentifierArrayField,
  parseProviderId,
  parseProviderResolvedCommitPayload,
  parseS3CommitPayload,
  parseS3ReconciliationPayload,
  parseSafeObjectKeyField,
} from "./commit-payload-parser";

describe("commit payload parser", () => {
  test("parses an explicit provider id", () => {
    const providerId = parseProviderId(
      { providerId: "provider_inline" },
      { providerId: "provider_default" }
    );

    expect(providerId).toBe("provider_inline");
  });

  test("falls back to default provider id when request does not include one", () => {
    const providerId = parseProviderId({}, { providerId: "provider_default" });

    expect(providerId).toBe("provider_default");
  });

  test("throws when provider id is unavailable", () => {
    expect(() => parseProviderId({}, {})).toThrow(
      "providerId must be configured or provided"
    );
  });

  test("falls back to default provider id for custom missing-provider errors", () => {
    expect(() => parseProviderId({}, {}, "providerId", "custom")).toThrow(
      "custom"
    );
  });

  test("parses and validates committedAt timestamps", () => {
    expect(
      parseCommitTimestamp(
        { committedAt: "2026-01-01T00:00:00.000Z" },
        "committedAt"
      )
    ).toBe("2026-01-01T00:00:00.000Z");

    expect(() =>
      parseCommitTimestamp({ committedAt: "soon" }, "committedAt")
    ).toThrow("committedAt must be a valid timestamp");
  });

  test("falls back to now when committedAt is not provided", () => {
    const now = () => "2026-01-01T00:00:00.000Z";

    expect(parseCommitTimestampOrNow({}, "committedAt", now)).toBe(
      "2026-01-01T00:00:00.000Z"
    );
  });

  test("parses optional safe object keys", () => {
    expect(parseOptionalSafeObjectKeyField({}, "objectKey")).toEqual({});
    expect(
      parseOptionalSafeObjectKeyField(
        { objectKey: "live/session/3810.m4s" },
        "objectKey"
      )
    ).toEqual({ objectKey: "live/session/3810.m4s" });
  });

  test("parses shared commit request fields", () => {
    expect(
      parseCommitRequestPayload({
        commitId: "commit_3810",
        committedAt: "2026-01-01T00:00:02.000Z",
        independent: true,
        lateToleranceMs: 123,
        maxSegments: 7,
        programDateTime: "2026-01-01T00:00:03.000Z",
        slotId: "slot_3810",
      })
    ).toEqual({
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: true,
      lateToleranceMs: 123,
      maxSegments: 7,
      programDateTime: "2026-01-01T00:00:03.000Z",
      slotId: "slot_3810",
    });
  });

  test("applies a custom committedAt parser when needed", () => {
    expect(
      parseCommitRequestPayload(
        {
          commitId: "commit_3810",
          slotId: "slot_3810",
        } as Record<string, unknown>,
        () => "2026-01-01T00:00:02.000Z"
      )
    ).toEqual({
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      slotId: "slot_3810",
    });
  });

  test("parses shared provider-resolved commit payload", () => {
    expect(
      parseProviderResolvedCommitPayload(
        {
          committedAt: "2026-01-01T00:00:02.000Z",
        },
        { providerId: "provider_1" }
      )
    ).toEqual({
      committedAt: "2026-01-01T00:00:02.000Z",
      providerId: "provider_1",
    });
  });

  test("parses required safe object key fields with an explicit field name", () => {
    expect(
      parseSafeObjectKeyField(
        { objectKey: "live/session/3810.m4s" },
        "objectKey",
        "object.objectKey"
      )
    ).toBe("live/session/3810.m4s");
  });

  test("throws for unsafe object keys", () => {
    expect(() =>
      parseSafeObjectKeyField(
        { objectKey: "../session/3810.m4s" },
        "objectKey",
        "object.objectKey"
      )
    ).toThrow("object.objectKey must be a safe relative object key");
  });

  test("parses optional URL-safe identifier arrays", () => {
    expect(parseOptionalUrlSafeIdentifierArrayField({}, "slotIds")).toEqual({});
    expect(
      parseOptionalUrlSafeIdentifierArrayField(
        { slotIds: ["slot_init", "slot_3810"] },
        "slotIds"
      )
    ).toEqual({ slotIds: ["slot_init", "slot_3810"] });
  });

  test("validates optional URL-safe identifier arrays", () => {
    expect(() =>
      parseOptionalUrlSafeIdentifierArrayField(
        { slotIds: ["slot_init", "../bad"] },
        "slotIds"
      )
    ).toThrow("slotIds must be a non-empty URL-safe identifier");
    expect(() =>
      parseOptionalUrlSafeIdentifierArrayField(
        { slotIds: ["slot_init", 1 as unknown] },
        "slotIds"
      )
    ).toThrow("slotIds must be a string array");
  });

  test("parses observed upload payloads and validates metadata", () => {
    expect(
      parseObservedUploadPayload({
        contentType: "video/mp4",
        etag: '"publisher-hint"',
        objectKey: "media/session_1.m4s",
        observedAt: "2026-01-01T00:00:00.000Z",
        providerId: "provider",
        size: 1024,
        metadata: {
          "x-olos-slot-id": "slot_1",
        },
      })
    ).toMatchObject({
      contentType: "video/mp4",
      etag: '"publisher-hint"',
      objectKey: "media/session_1.m4s",
      observedAt: "2026-01-01T00:00:00.000Z",
      providerId: "provider",
      size: 1024,
      metadata: { "x-olos-slot-id": "slot_1" },
    });

    expect(() =>
      parseObservedUploadPayload({
        contentType: "video/mp4",
        objectKey: "media/session_1.m4s",
        observedAt: "2026-01-01T00:00:00.000Z",
        providerId: "provider",
        size: 1024,
        metadata: { "x-olos-slot-id": 4 },
      } as Record<string, unknown>)
    ).toThrow("object.metadata must be a string map");
  });

  test("parses shared S3 commit payloads", () => {
    expect(
      parseS3CommitPayload(
        {
          committedAt: "2026-01-01T00:00:02.000Z",
          commitId: "commit_3810",
          slotId: "slot_3810",
          objectKey: "live/session/3810.m4s",
          versionId: "v1",
          independent: true,
        },
        { providerId: "provider_1" }
      )
    ).toMatchObject({
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: true,
      providerId: "provider_1",
      slotId: "slot_3810",
      objectKey: "live/session/3810.m4s",
      versionId: "v1",
    });
  });

  test("accepts custom committedAt parsing for shared S3 commit helpers", () => {
    expect(
      parseS3CommitPayload(
        {
          commitId: "commit_3810",
          slotId: "slot_3810",
          objectKey: "live/session/3810.m4s",
        },
        { providerId: "provider_1" },
        () => "2026-01-01T00:00:02.000Z"
      )
    ).toMatchObject({
      committedAt: "2026-01-01T00:00:02.000Z",
      providerId: "provider_1",
      commitId: "commit_3810",
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
          slotIds: ["slot_init", "slot_3810"],
          versionId: "v1",
          independent: true,
        },
        {
          providerId: "provider_fallback",
        }
      )
    ).toMatchObject({
      providerId: "provider_fallback",
      committedAt: "2026-01-01T00:00:02.000Z",
      slotIds: ["slot_init", "slot_3810"],
      versionId: "v1",
      independent: true,
    });
  });
});
