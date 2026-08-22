import { CONFORMANCE_DELIVERY_BASE_URL } from "../conformance/pipeline-store";
import { createObservedUpload } from "../state/observed-upload";
import type { ProfileData } from "../types/profile";
import type { Session } from "../types/session";
import { commitCoordinatorUpload } from "./coordinator-commit";
import { createCoordinatorPipeline } from "./coordinator-lifecycle";
import { issueCoordinatorSlot } from "./coordinator-slot";
import type { CoordinatorPipelineState } from "./coordinator-types";

/** A live CMAF/LL-HLS session with one 1080p video track. */
export const testCoordinatorSession: Session = {
  createdAt: "2026-01-01T00:00:00.000Z",
  epoch: 1,
  olos: "1.0",
  profile: { id: "cmaf-llhls", partTarget: 0.5, segmentTarget: 2 },
  sessionId: "session_1",
  state: "live",
  tracks: [
    {
      profile: {
        bitrate: 5_000_000,
        codec: "avc1.640028",
        frameRate: 30,
        height: 1080,
        kind: "video",
        width: 1920,
      },
      trackId: "v1080",
    },
  ],
};

export const TEST_COORDINATOR_DELIVERY_BASE_URL = CONFORMANCE_DELIVERY_BASE_URL;

// Helper sessions use read-gated publication so the coordinator derives
// deterministic object addresses (no random nonce), letting tests assert
// against known keys: objects/<track>/init.mp4 and objects/<track>/s<n>.m4s.
export function createEmptyCoordinatorState(): CoordinatorPipelineState {
  return createCoordinatorPipeline({
    deliveryBaseUrl: TEST_COORDINATOR_DELIVERY_BASE_URL,
    publicationMode: "read-gated",
    session: testCoordinatorSession,
  });
}

export function createCoordinatorStateWithIssuedSegment(): CoordinatorPipelineState {
  const initCommit = commitTestCoordinatorSlot(createEmptyCoordinatorState(), {
    commitId: "commit_init",
    contentType: "video/mp4",
    kind: "init",
    profile: { duration: 1 },
    maxBytes: 2048,
    sequenceNumber: 0,
    size: 1024,
    slotId: "slot_init",
  });

  return issueTestCoordinatorSlot(initCommit, testCoordinatorSegmentSlot())
    .state;
}

export function createCoordinatorStateWithCommittedSegment(): CoordinatorPipelineState {
  return commitIssuedTestCoordinatorSlot(
    createCoordinatorStateWithIssuedSegment(),
    {
      ...testCoordinatorSegmentSlot(),
      commitId: "commit_3810",
      profile: { independent: true },
      size: 98_304,
    }
  );
}

interface TestCoordinatorSlot {
  commitId?: string;
  contentType: string;
  kind: "init" | "segment";
  maxBytes: number;
  profile?: ProfileData;
  sequenceNumber: number;
  size?: number;
  slotId: string;
}

function testCoordinatorSegmentSlot(): TestCoordinatorSlot {
  return {
    contentType: "video/mp4",
    kind: "segment",
    maxBytes: 100_000,
    profile: { duration: 2 },
    sequenceNumber: 3810,
    slotId: "slot_3810",
  };
}

function commitTestCoordinatorSlot(
  state: CoordinatorPipelineState,
  slot: TestCoordinatorSlot & { commitId: string; size: number }
): CoordinatorPipelineState {
  return commitIssuedTestCoordinatorSlot(
    issueTestCoordinatorSlot(state, slot).state,
    slot
  );
}

function commitIssuedTestCoordinatorSlot(
  state: CoordinatorPipelineState,
  slot: TestCoordinatorSlot & { commitId: string; size: number }
): CoordinatorPipelineState {
  const objectKey = state.slots.find(
    (s) => s.slotId === slot.slotId
  )?.objectKey;

  if (objectKey === undefined) {
    throw new Error(`missing slot ${slot.slotId} for commit`);
  }

  const committed = commitCoordinatorUpload({
    commitId: slot.commitId,
    committedAt: "2026-01-01T00:00:02.000Z",
    object: createObservedUpload({
      contentType: slot.contentType,
      objectKey,
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      size: slot.size,
    }),
    profile: slot.profile,
    slotId: slot.slotId,
    state,
  });

  if (committed.status !== "committed") {
    throw new Error("expected committed coordinator slot");
  }

  return committed.state;
}

function issueTestCoordinatorSlot(
  state: CoordinatorPipelineState,
  slot: TestCoordinatorSlot
) {
  return issueCoordinatorSlot({
    contentType: slot.contentType,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: slot.kind,
    maxBytes: slot.maxBytes,
    profile: slot.profile,
    sequenceNumber: slot.sequenceNumber,
    trackId: "v1080",
    slotId: slot.slotId,
    state,
  });
}
