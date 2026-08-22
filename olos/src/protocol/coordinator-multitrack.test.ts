import { describe, expect, test } from "bun:test";
import { createObservedUpload } from "../state/observed-upload";
import type { ProfileData } from "../types/profile";
import type { Session } from "../types/session";
import type { ObjectKind } from "../types/storage-object";
import { commitCoordinatorUpload } from "./coordinator-commit";
import { createCoordinatorPipeline } from "./coordinator-lifecycle";
import { issueCoordinatorSlot } from "./coordinator-slot";
import {
  TEST_COORDINATOR_DELIVERY_BASE_URL,
  testCoordinatorSession,
} from "./coordinator-state.test-helper";
import type {
  CoordinatorPipelineState,
  CoordinatorUploadCommit,
} from "./coordinator-types";

// Bug regression: `isLateSlot` used to compare a slot against the
// window-global last sequence number/part, so once one track ran ahead every
// commit from a trailing track was rejected as `late_object` forever.
// Lateness must be evaluated against the slot's own track's live edge.

const multiTrackSession: Session = {
  ...testCoordinatorSession,
  tracks: [
    ...testCoordinatorSession.tracks,
    {
      profile: { bitrate: 128_000, codec: "mp4a.40.2", kind: "audio" },
      trackId: "a128",
    },
  ],
};

function createMultiTrackState(): CoordinatorPipelineState {
  return createCoordinatorPipeline({
    deliveryBaseUrl: TEST_COORDINATOR_DELIVERY_BASE_URL,
    publicationMode: "read-gated",
    session: multiTrackSession,
  });
}

interface TrackCommitOptions {
  kind: ObjectKind;
  partNumber?: number;
  profile?: ProfileData;
  sequenceNumber: number;
  slotId: string;
  trackId: string;
}

function commitTrackSlot(
  state: CoordinatorPipelineState,
  options: TrackCommitOptions
): CoordinatorUploadCommit {
  const issued = issueCoordinatorSlot({
    contentType: "video/mp4",
    expiresAt: "2026-01-01T00:00:30.000Z",
    kind: options.kind,
    maxBytes: 100_000,
    partNumber: options.partNumber,
    profile: options.profile ?? { duration: 2 },
    sequenceNumber: options.sequenceNumber,
    slotId: options.slotId,
    state,
    trackId: options.trackId,
  });

  return commitCoordinatorUpload({
    commitId: `commit_${options.slotId}`,
    committedAt: "2026-01-01T00:00:02.000Z",
    object: createObservedUpload({
      contentType: "video/mp4",
      objectKey: issued.slot.objectKey,
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      size: 10_000,
    }),
    slotId: options.slotId,
    state: issued.state,
  });
}

function mustCommitTrack(
  result: CoordinatorUploadCommit
): CoordinatorPipelineState {
  if (result.status !== "committed") {
    throw new Error(`expected committed upload, received ${result.status}`);
  }

  return result.state;
}

describe("multi-track commit lateness", () => {
  test("commits a trailing track's full segments once the leading track is ahead", () => {
    let state = createMultiTrackState();
    state = mustCommitTrack(
      commitTrackSlot(state, {
        kind: "init",
        sequenceNumber: 0,
        slotId: "slot_v_init",
        trackId: "v1080",
      })
    );
    state = mustCommitTrack(
      commitTrackSlot(state, {
        kind: "init",
        sequenceNumber: 0,
        slotId: "slot_a_init",
        trackId: "a128",
      })
    );

    for (const msn of [0, 1, 2]) {
      state = mustCommitTrack(
        commitTrackSlot(state, {
          kind: "segment",
          sequenceNumber: msn,
          slotId: `slot_v_s${msn}`,
          trackId: "v1080",
        })
      );
    }

    // Video is now two full segments ahead of audio. Under the old
    // window-global comparison, audio's segment 0 would look "behind" the
    // cursor's lastSequenceNumber (2) and be rejected forever.
    const audio0 = commitTrackSlot(state, {
      kind: "segment",
      sequenceNumber: 0,
      slotId: "slot_a_s0",
      trackId: "a128",
    });
    expect(audio0.status).toBe("committed");
    state = mustCommitTrack(audio0);

    const audio1 = commitTrackSlot(state, {
      kind: "segment",
      sequenceNumber: 1,
      slotId: "slot_a_s1",
      trackId: "a128",
    });
    expect(audio1.status).toBe("committed");
    state = mustCommitTrack(audio1);

    expect(
      state.cursor?.committedWindow.tracks.a128?.segments.map(
        (segment) => segment.sequenceNumber
      )
    ).toEqual([0, 1]);
  });

  test("commits a trailing track's part once the leading track is ahead on parts", () => {
    let state = createMultiTrackState();
    state = mustCommitTrack(
      commitTrackSlot(state, {
        kind: "init",
        sequenceNumber: 0,
        slotId: "slot_v_init",
        trackId: "v1080",
      })
    );
    state = mustCommitTrack(
      commitTrackSlot(state, {
        kind: "init",
        sequenceNumber: 0,
        slotId: "slot_a_init",
        trackId: "a128",
      })
    );

    state = mustCommitTrack(
      commitTrackSlot(state, {
        kind: "part",
        partNumber: 0,
        profile: { duration: 0.5, independent: true },
        sequenceNumber: 0,
        slotId: "slot_v_s0_p0",
        trackId: "v1080",
      })
    );
    state = mustCommitTrack(
      commitTrackSlot(state, {
        kind: "part",
        partNumber: 1,
        profile: { duration: 0.5 },
        sequenceNumber: 0,
        slotId: "slot_v_s0_p1",
        trackId: "v1080",
      })
    );

    // Video is now one part ahead of audio's still-unstarted segment 0.
    const audioPart0 = commitTrackSlot(state, {
      kind: "part",
      partNumber: 0,
      profile: { duration: 0.5, independent: true },
      sequenceNumber: 0,
      slotId: "slot_a_s0_p0",
      trackId: "a128",
    });
    expect(audioPart0.status).toBe("committed");
    state = mustCommitTrack(audioPart0);

    expect(
      state.cursor?.committedWindow.tracks.a128?.segments.map((segment) => [
        segment.sequenceNumber,
        segment.parts?.map((part) => part.partNumber),
      ])
    ).toEqual([[0, [0]]]);
  });
});
