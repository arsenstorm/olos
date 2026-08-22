import { describe, expect, test } from "bun:test";
import { createMemoryCoordinatorStore } from "./coordinator-memory-store";
import {
  createCoordinatorStateWithCommittedSegment,
  testCoordinatorSession as session,
} from "./coordinator-state.test-helper";
import { savedStoreResult } from "./test-store.test-helper";

describe("memory coordinator store", () => {
  test("keeps loaded state and cursor views isolated from stored clones", async () => {
    const store = createMemoryCoordinatorStore();
    const state = createCoordinatorStateWithCommittedSegment();

    const saved = savedStoreResult(
      await store.save({ sessionId: session.sessionId, state }),
      "expected first save"
    );

    const loaded = await store.load(session.sessionId);

    if (loaded === undefined) {
      throw new Error("expected stored snapshot");
    }

    const originalSegments =
      saved.state.cursor?.committedWindow.tracks.v1080?.segments.length;
    const originalProfile = loaded.state.slots.find(
      (candidate) => candidate.slotId === "slot_3810"
    )?.profile;

    expect(originalSegments).toBeGreaterThan(0);
    expect(originalProfile).toEqual({ duration: 2 });

    const expectedProfile = structuredClone(originalProfile);

    const cursor = loaded.state.cursor;
    const slot = loaded.state.slots.find(
      (candidate) => candidate.slotId === "slot_3810"
    );

    if (
      cursor === undefined ||
      slot === undefined ||
      slot.profile === undefined
    ) {
      throw new Error("expected cursor and committed slot with a profile");
    }

    const track = cursor.committedWindow.tracks.v1080;

    if (track === undefined) {
      throw new Error("expected v1080 track window");
    }

    track.segments.length = 0;
    slot.profile.duration = -1;

    const reloaded = await store.load(session.sessionId);
    const reloadedCursor = await store.loadCursor?.(session.sessionId);

    expect(
      reloaded?.state.cursor?.committedWindow.tracks.v1080?.segments.length
    ).toBe(originalSegments);
    expect(
      reloaded?.state.slots.find(
        (candidate) => candidate.slotId === "slot_3810"
      )?.profile
    ).toEqual(expectedProfile);
    expect(
      reloadedCursor?.cursor?.committedWindow.tracks.v1080?.segments.length
    ).toBe(originalSegments);
  });
});
