import { describe, expect, test } from "bun:test";
import { createEmptyCoordinatorState } from "../protocol/coordinator-state.test-helper";
import { createOlosError } from "../types/errors";
import type { UploadSlot } from "../types/upload-slot";
import {
  committedUploadRuntimeCommandResponse,
  invalidRuntimeCommandResponse,
  issuedSlotRuntimeCommandResponse,
  rejectedRuntimeCommandResult,
} from "./command-response";

const slot: UploadSlot = {
  contentType: "video/mp4",
  deliveryUrl: "https://media.example.com/s3810.m4s",
  duration: 2,
  epoch: 0,
  expiresAt: "2026-01-01T00:00:05.000Z",
  kind: "segment",
  maxBytes: 100_000,
  mediaSequenceNumber: 3810,
  objectKey: "media/s3810.m4s",
  publicationMode: "direct-public",
  publisherInstanceId: "pub_1",
  renditionId: "v1080",
  slotId: "slot_3810",
  state: "issued",
};

describe("runtime command response helpers", () => {
  test("formats invalid command responses", async () => {
    const response = invalidRuntimeCommandResponse("invalid request");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { message: "invalid request" },
    });
  });

  test("formats issued slot command responses", async () => {
    const response = issuedSlotRuntimeCommandResponse(slot);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ slot });
  });

  test("formats committed upload command responses", async () => {
    const response = committedUploadRuntimeCommandResponse({
      commit: {
        commitId: "commit_3810",
        committedAt: "2026-01-01T00:00:02.000Z",
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/s3810.m4s",
        duration: 2,
        epoch: 0,
        independent: true,
        kind: "segment",
        mediaSequenceNumber: 3810,
        objectKey: "media/s3810.m4s",
        providerId: "s3_primary",
        renditionId: "v1080",
        size: 98_304,
        slotId: "slot_3810",
      },
      state: createEmptyCoordinatorState(),
      status: "committed",
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      commit: { commitId: "commit_3810", slotId: "slot_3810" },
    });
  });

  test("formats rejected command results", async () => {
    const state = createEmptyCoordinatorState();
    const error = createOlosError("olos.unknown_slot", "slot not found", {
      slotId: "slot_missing",
    });
    const result = rejectedRuntimeCommandResult(error, state);

    expect(result.status).toBe("rejected");
    expect(result.state).toBe(state);
    expect(result.response.status).toBe(404);
    expect(await result.response.json()).toEqual(error);
  });
});
