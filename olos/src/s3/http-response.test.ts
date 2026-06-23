import { describe, expect, test } from "bun:test";
import { createEmptyCoordinatorState } from "../protocol/coordinator-state.test-helper";
import type { UploadSlot } from "../types/upload-slot";
import { eventRouteResult, reconciliationResult } from "./http-response";
import type { StoredS3CoordinatorUploadReconciliationResult } from "./reconciliation";

describe("S3 HTTP response mapping", () => {
  test("maps rejected event route results with audit details", () => {
    expect(
      eventRouteResult({
        auditEvent: { reason: "policy" },
        error: {
          error: {
            code: "olos.quota_exceeded",
            message: "tenant quota exceeded",
          },
        },
        status: "rejected",
      })
    ).toEqual({
      auditEvent: { reason: "policy" },
      error: {
        code: "olos.quota_exceeded",
        message: "tenant quota exceeded",
      },
      status: "rejected",
    });
  });

  test("keeps the rejected event fallback error message", () => {
    expect(eventRouteResult({ status: "rejected" })).toEqual({
      error: { message: "S3 route rejected without error details" },
      status: "rejected",
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
    publicationMode: "direct-public",
    publisherInstanceId: "publisher_1",
    renditionId: "v1080",
    sessionId: "session_1",
    slotId: "slot_3810",
    state: "issued",
    tenantId: "tenant_1",
  };
}
