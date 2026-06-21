import { describe, expect, test } from "bun:test";

import {
  parseCommitRequestPayload,
  parseCommitTimestamp,
  parseCommitTimestampOrNow,
  parseOptionalSafeObjectKeyField,
  parseOptionalUrlSafeIdentifierArrayField,
  parseProviderId,
  parseProviderResolvedCommitPayload,
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
});
