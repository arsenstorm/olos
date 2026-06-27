import { describe, expect, test } from "bun:test";
import { createEmptyCoordinatorState } from "../protocol/coordinator-state.test-helper";
import type { UploadSlot } from "../types/upload-slot";
import { eventRouteResult, reconciliationResult } from "./http-response";
import type { StoredS3CoordinatorUploadReconciliationResult } from "./reconciliation";

describe("S3 HTTP response mapping", () => {
  test("maps rejected event route results with audit details", () => {
    expect(
      eventRouteResult({
        auditEvent: {
          error: {
            error: {
              code: "olos.quota_exceeded",
              message: "tenant quota exceeded",
            },
          },
          eventType: "upload.rejected",
          maxBytes: 100_000,
          objectKey: "media/v1080/3810.m4s",
          observedBytes: 100_001,
          occurredAt: "2026-01-01T00:00:02.000Z",
          reason: "object_too_large",
          slotId: "slot_3810",
        },
        error: {
          error: {
            code: "olos.quota_exceeded",
            message: "tenant quota exceeded",
          },
        },
        state: createEmptyCoordinatorState(),
        status: "rejected",
      })
    ).toEqual({
      auditEvent: {
        error: {
          error: {
            code: "olos.quota_exceeded",
            message: "tenant quota exceeded",
          },
        },
        eventType: "upload.rejected",
        maxBytes: 100_000,
        objectKey: "media/v1080/3810.m4s",
        observedBytes: 100_001,
        occurredAt: "2026-01-01T00:00:02.000Z",
        reason: "object_too_large",
        slotId: "slot_3810",
      },
      error: {
        code: "olos.quota_exceeded",
        message: "tenant quota exceeded",
      },
      status: "rejected",
    });
  });

  test("maps terminal event route statuses", () => {
    expect(eventRouteResult({ status: "conflict" })).toEqual({
      status: "conflict",
    });
    expect(eventRouteResult({ status: "not_found" })).toEqual({
      status: "not_found",
    });
  });

  test("maps failed reconciliation results with thrown errors", () => {
    expect(
      reconciliationResult({
        error: "missing object: media/v1080/3810.m4s",
        slot: testSlot(),
        status: "failed",
      })
    ).toEqual({
      error: { message: "missing object: media/v1080/3810.m4s" },
      slotId: "slot_3810",
      status: "failed",
    });
  });

  test("maps failed reconciliation results with unsuccessful result statuses", () => {
    const result = {
      result: {
        status: "not_found",
      },
      slot: testSlot(),
      status: "failed",
    } satisfies StoredS3CoordinatorUploadReconciliationResult;

    expect(reconciliationResult(result)).toEqual({
      resultStatus: "not_found",
      slotId: "slot_3810",
      status: "failed",
    });
  });

  test("maps failed reconciliation results with thrown errors and statuses", () => {
    const result = {
      error: "missing object: media/v1080/3810.m4s",
      result: {
        status: "conflict",
      },
      slot: testSlot(),
      status: "failed",
    } satisfies StoredS3CoordinatorUploadReconciliationResult;

    expect(reconciliationResult(result)).toEqual({
      error: { message: "missing object: media/v1080/3810.m4s" },
      resultStatus: "conflict",
      slotId: "slot_3810",
      status: "failed",
    });
  });

  test("maps rejected failed reconciliation results with structured errors", () => {
    const result = {
      result: {
        error: {
          error: {
            code: "olos.quota_exceeded",
            message: "tenant quota exceeded",
          },
        },
        state: createEmptyCoordinatorState(),
        status: "rejected",
      },
      slot: testSlot(),
      status: "failed",
    } satisfies StoredS3CoordinatorUploadReconciliationResult;

    expect(reconciliationResult(result)).toEqual({
      error: {
        code: "olos.quota_exceeded",
        message: "tenant quota exceeded",
      },
      slotId: "slot_3810",
      status: "failed",
    });
  });
});

function testSlot(): UploadSlot {
  return {
    contentType: "video/mp4",
    deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
    duration: 2,
    epoch: 1,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: "segment",
    maxBytes: 100_000,
    mediaSequenceNumber: 3810,
    objectKey: "media/v1080/3810.m4s",
    publisherInstanceId: "publisher_1",
    renditionId: "v1080",
    sessionId: "session_1",
    slotId: "slot_3810",
    state: "issued",
    tenantId: "tenant_1",
  };
}
