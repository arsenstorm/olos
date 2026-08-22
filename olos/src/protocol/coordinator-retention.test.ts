import { describe, expect, test } from "bun:test";

import { createObservedUpload } from "../state/observed-upload";
import type { ProfileData } from "../types/profile";
import { commitCoordinatorUpload } from "./coordinator-commit";
import { applyCoordinatorRetention } from "./coordinator-retention";
import { issueCoordinatorSlot } from "./coordinator-slot";
import { createEmptyCoordinatorState } from "./coordinator-state.test-helper";
import type { CoordinatorPipelineState } from "./coordinator-types";

const RETENTION_NOW = "2026-01-01T00:00:06.000Z";

describe("coordinator retention application", () => {
  test("prunes expired issued upload slots outside the commit path", () => {
    const state = issueCoordinatorSlot({
      contentType: "video/mp4",
      profile: { duration: 2 },
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      sequenceNumber: 3813,
      trackId: "v1080",
      slotId: "slot_3813",
      state: committedWindowState().state,
    }).state;

    const applied = applyCoordinatorRetention({ now: RETENTION_NOW, state });

    expect(applied.expiredSlots.map((slot) => slot.slotId)).toEqual([
      "slot_3813",
    ]);
    expect(applied.retiredObjects).toEqual([]);
    expect(applied.state.slots.map((slot) => slot.slotId)).not.toContain(
      "slot_3813"
    );
    expect(applied.state.commits).toEqual(state.commits);
    expect(applied.state.cursor).toEqual(state.cursor);
  });

  test("keeps unexpired issued slots when applying retention", () => {
    const state = issueCoordinatorSlot({
      contentType: "video/mp4",
      profile: { duration: 2 },
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      sequenceNumber: 3813,
      trackId: "v1080",
      slotId: "slot_3813",
      state: committedWindowState().state,
    }).state;

    const applied = applyCoordinatorRetention({
      now: "2026-01-01T00:00:04.000Z",
      state,
    });

    expect(applied.expiredSlots).toEqual([]);
    expect(applied.state).toBe(state);
  });

  test("keeps issued slots within the late tolerance and prunes past it", () => {
    const state = issueCoordinatorSlot({
      contentType: "video/mp4",
      profile: { duration: 2 },
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      sequenceNumber: 3813,
      trackId: "v1080",
      slotId: "slot_3813",
      state: committedWindowState().state,
    }).state;

    const tolerated = applyCoordinatorRetention({
      lateToleranceMs: 5000,
      now: "2026-01-01T00:00:09.999Z",
      state,
    });

    expect(tolerated.expiredSlots).toEqual([]);
    expect(tolerated.state).toBe(state);

    const pruned = applyCoordinatorRetention({
      lateToleranceMs: 5000,
      now: "2026-01-01T00:00:10.000Z",
      state,
    });

    expect(pruned.expiredSlots.map((slot) => slot.slotId)).toEqual([
      "slot_3813",
    ]);
  });

  test("lets a late commit land after a tolerant retention sweep", () => {
    // Slot expires at 00:00:05. A sweep 1ms later with the commit path's
    // tolerance must not prune it, so a late upload at expiry+4s commits.
    const issued = issueCoordinatorSlot({
      contentType: "video/mp4",
      profile: { duration: 2 },
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      sequenceNumber: 3813,
      trackId: "v1080",
      slotId: "slot_3813",
      state: committedWindowState().state,
    });

    const swept = applyCoordinatorRetention({
      lateToleranceMs: 5000,
      now: "2026-01-01T00:00:05.001Z",
      state: issued.state,
    });

    expect(swept.expiredSlots).toEqual([]);

    const committed = commitCoordinatorUpload({
      commitId: "commit_3813",
      committedAt: "2026-01-01T00:00:09.000Z",
      lateToleranceMs: 5000,
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: issued.slot.objectKey,
        observedAt: "2026-01-01T00:00:09.000Z",
        providerId: "s3_primary",
        size: 98_304,
      }),
      slotId: "slot_3813",
      state: swept.state,
    });

    expect(committed.status).toBe("committed");
  });

  test("retires commits behind the window and prunes their slots", () => {
    const { state, staleCommit, staleSlot } = committedWindowState();
    // Re-introduce the commit + slot that commit-time auto-retention already
    // pruned, modelling a snapshot persisted before pruning existed.
    const staleState: CoordinatorPipelineState = {
      ...state,
      commits: [staleCommit, ...state.commits],
      slots: [staleSlot, ...state.slots],
    };

    const applied = applyCoordinatorRetention({
      now: RETENTION_NOW,
      state: staleState,
    });

    expect(applied.retiredObjects).toEqual([
      {
        commitId: "commit_3810",
        objectKey: "objects/v1080/s3810",
        slotId: "slot_3810",
      },
    ]);
    expect(applied.expiredSlots).toEqual([]);
    expect(applied.state.commits).toEqual(state.commits);
    expect(applied.state.slots).toEqual(state.slots);
    expect(applied.state.cursor).toEqual(state.cursor);
  });

  test("returns the same state reference when there is nothing to prune", () => {
    const { state } = committedWindowState();

    const applied = applyCoordinatorRetention({ now: RETENTION_NOW, state });

    expect(applied.state).toBe(state);
    expect(applied.expiredSlots).toEqual([]);
    expect(applied.retiredObjects).toEqual([]);
  });

  test("prunes expired slots without a cursor and keeps retiredObjects empty", () => {
    const state = issueCoordinatorSlot({
      contentType: "video/mp4",
      profile: { duration: 2 },
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      sequenceNumber: 3810,
      trackId: "v1080",
      slotId: "slot_3810",
      state: createEmptyCoordinatorState(),
    }).state;

    const applied = applyCoordinatorRetention({ now: RETENTION_NOW, state });

    expect(applied.retiredObjects).toEqual([]);
    expect(applied.expiredSlots.map((slot) => slot.slotId)).toEqual([
      "slot_3810",
    ]);
    expect(applied.state.slots).toEqual([]);
  });

  test("matches the commit path's auto-retention pruning", () => {
    // The commit that shrinks the window to two segments prunes commit_3810
    // through the same shared core; standalone retention against the
    // pre-shrink commits with the shrunk cursor must retire the same commit.
    const { beforeWindowShrink, state } = committedWindowState();
    const applied = applyCoordinatorRetention({
      now: RETENTION_NOW,
      state: { ...beforeWindowShrink, cursor: state.cursor },
    });

    expect(applied.retiredObjects.map((object) => object.commitId)).toEqual([
      "commit_3810",
    ]);
    expect(applied.state.commits.map((commit) => commit.commitId)).toEqual([
      "commit_3811",
    ]);
    expect(applied.state.slots.map((slot) => slot.slotId)).toEqual([
      "slot_init",
      "slot_3811",
    ]);
  });
});

interface CommittedWindowStateFixture {
  beforeWindowShrink: CoordinatorPipelineState;
  staleCommit: CoordinatorPipelineState["commits"][number];
  staleSlot: CoordinatorPipelineState["slots"][number];
  state: CoordinatorPipelineState;
}

// Commits msn 3810..3812 with maxSegments 2 on the final commit, so
// commit-time auto-retention prunes commit_3810/slot_3810 from the returned
// state. The pruned pair is captured from the intermediate state so tests can
// model stale snapshots that still carry them.
function committedWindowState(): CommittedWindowStateFixture {
  let state = createEmptyCoordinatorState();

  state = commitSlot(state, {
    commitId: "commit_init",
    profile: { duration: 1 },
    kind: "init",
    maxBytes: 2048,
    sequenceNumber: 0,
    size: 1024,
    slotId: "slot_init",
  });
  state = commitSlot(state, {
    commitId: "commit_3810",
    profile: { duration: 2 },
    maxBytes: 100_000,
    sequenceNumber: 3810,
    size: 98_304,
    slotId: "slot_3810",
  });
  state = commitSlot(state, {
    commitId: "commit_3811",
    profile: { duration: 2 },
    maxBytes: 100_000,
    sequenceNumber: 3811,
    size: 98_304,
    slotId: "slot_3811",
  });

  const beforeWindowShrink = state;
  const staleCommit = state.commits.find(
    (commit) => commit.commitId === "commit_3810"
  );
  const staleSlot = state.slots.find((slot) => slot.slotId === "slot_3810");

  if (staleCommit === undefined || staleSlot === undefined) {
    throw new Error("expected commit_3810 fixture before window shrink");
  }

  state = commitSlot(state, {
    commitId: "commit_3812",
    profile: { duration: 2 },
    maxBytes: 100_000,
    maxSegments: 2,
    sequenceNumber: 3812,
    size: 98_304,
    slotId: "slot_3812",
  });

  return { beforeWindowShrink, staleCommit, staleSlot, state };
}

interface CommitSlotOptions {
  commitId: string;
  kind?: "init" | "segment";
  maxBytes: number;
  maxSegments?: number;
  profile: ProfileData;
  sequenceNumber: number;
  size: number;
  slotId: string;
}

function commitSlot(
  state: CoordinatorPipelineState,
  options: CommitSlotOptions
): CoordinatorPipelineState {
  const issued = issueCoordinatorSlot({
    contentType: "video/mp4",
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: options.kind ?? "segment",
    maxBytes: options.maxBytes,
    profile: options.profile,
    sequenceNumber: options.sequenceNumber,
    trackId: "v1080",
    slotId: options.slotId,
    state,
  });
  const committed = commitCoordinatorUpload({
    commitId: options.commitId,
    committedAt: "2026-01-01T00:00:02.000Z",
    maxSegments: options.maxSegments,
    profile: options.kind === "init" ? undefined : { independent: true },
    object: createObservedUpload({
      contentType: "video/mp4",
      objectKey: issued.slot.objectKey,
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      size: options.size,
    }),
    slotId: options.slotId,
    state: issued.state,
  });

  if (committed.status !== "committed") {
    throw new Error("expected committed upload");
  }

  return committed.state;
}
