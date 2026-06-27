import { createObservedUpload } from "../state/observed-upload";
import type { Session } from "../types/session";
import {
  type CoordinatorPipelineState,
  commitCoordinatorUpload,
  createCoordinatorPipeline,
  issueCoordinatorSlot,
} from "./coordinator";

export const testCoordinatorSession: Session = {
  createdAt: "2026-01-01T00:00:00.000Z",
  epoch: 1,
  latencyProfile: "object-ll",
  olos: "1.0",
  partTarget: 0.5,
  renditions: [
    {
      bitrate: 5_000_000,
      codec: "avc1.640028",
      frameRate: 30,
      height: 1080,
      kind: "video",
      renditionId: "v1080",
      width: 1920,
    },
  ],
  segmentTarget: 2,
  sessionId: "session_1",
  state: "live",
};

export const TEST_COORDINATOR_MEDIA_BASE_URL = "https://media.example.com";

export function createEmptyCoordinatorState(): CoordinatorPipelineState {
  return createCoordinatorPipeline({
    mediaBaseUrl: TEST_COORDINATOR_MEDIA_BASE_URL,
    session: testCoordinatorSession,
  });
}

export function createCoordinatorStateWithIssuedSegment(): CoordinatorPipelineState {
  const initCommit = commitTestCoordinatorSlot(createEmptyCoordinatorState(), {
    commitId: "commit_init",
    contentType: "video/mp4",
    deliveryUrl: "https://media.example.com/init.mp4",
    duration: 1,
    kind: "init",
    maxBytes: 2048,
    mediaSequenceNumber: 0,
    objectKey: "media/init.mp4",
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
      independent: true,
      size: 98_304,
    }
  );
}

interface TestCoordinatorSlot {
  commitId?: string;
  contentType: string;
  deliveryUrl: string;
  duration: number;
  independent?: boolean;
  kind: "init" | "segment";
  maxBytes: number;
  mediaSequenceNumber: number;
  objectKey: string;
  size?: number;
  slotId: string;
}

function testCoordinatorSegmentSlot(): TestCoordinatorSlot {
  return {
    contentType: "video/mp4",
    deliveryUrl: "https://media.example.com/s3810.m4s",
    duration: 2,
    kind: "segment",
    maxBytes: 100_000,
    mediaSequenceNumber: 3810,
    objectKey: "media/s3810.m4s",
    slotId: "slot_3810",
  };
}

function commitTestCoordinatorSlot(
  state: CoordinatorPipelineState,
  slot: TestCoordinatorSlot & { commitId: string; size: number }
): CoordinatorPipelineState {
  const issued = issueTestCoordinatorSlot(state, slot);

  return commitIssuedTestCoordinatorSlot(issued.state, slot);
}

function commitIssuedTestCoordinatorSlot(
  state: CoordinatorPipelineState,
  slot: TestCoordinatorSlot & { commitId: string; size: number }
): CoordinatorPipelineState {
  const committed = commitCoordinatorUpload({
    commitId: slot.commitId,
    committedAt: "2026-01-01T00:00:02.000Z",
    independent: slot.independent,
    object: createObservedUpload({
      contentType: slot.contentType,
      objectKey: slot.objectKey,
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      size: slot.size,
    }),
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
    deliveryUrl: slot.deliveryUrl,
    duration: slot.duration,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: slot.kind,
    maxBytes: slot.maxBytes,
    mediaSequenceNumber: slot.mediaSequenceNumber,
    objectKey: slot.objectKey,
    renditionId: "v1080",
    slotId: slot.slotId,
    state,
  });
}
