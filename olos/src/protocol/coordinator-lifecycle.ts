import { createHlsManifestArtifacts } from "../hls/manifest-artifacts";
import {
  selectExpiredUploadSlots,
  selectRetiredCommittedObjects,
} from "../state/retention";
import type { CommittedWindow } from "../types/committed-window";
import type { Cursor } from "../types/cursor";
import type { Session } from "../types/session";
import type { PublicationMode } from "../types/upload-slot";
import { assertSafeDeliveryUrl } from "../validation/delivery-url";
import { assertSession } from "../validation/session";
import type {
  CoordinatorManifestArtifacts,
  CoordinatorPipelineState,
  CoordinatorRetentionPlan,
  CreateCoordinatorManifestArtifactsOptions,
  PlanCoordinatorRetentionOptions,
} from "./coordinator";

export function createCoordinatorPipeline(options: {
  mediaBaseUrl: string;
  publicationMode?: PublicationMode;
  session: Session;
}): CoordinatorPipelineState {
  assertSession(options.session);
  assertSafeDeliveryUrl(options.mediaBaseUrl, "mediaBaseUrl");

  return {
    commits: [],
    initCommits: [],
    mediaBaseUrl: options.mediaBaseUrl,
    publicationMode: options.publicationMode ?? "direct-public",
    publisherLeases: [],
    session: options.session,
    slots: [],
  };
}

export function createCoordinatorManifestArtifacts(
  options: CreateCoordinatorManifestArtifactsOptions
): CoordinatorManifestArtifacts {
  const cursor = options.state.cursor;

  if (cursor === undefined) {
    return { artifacts: [] };
  }

  const { state, ...artifactOptions } = options;

  return {
    artifacts: createHlsManifestArtifacts(
      state.session,
      cursor.committedWindow,
      artifactOptions
    ),
    cursor,
  };
}

export function planCoordinatorRetention(
  options: PlanCoordinatorRetentionOptions
): CoordinatorRetentionPlan {
  return {
    expiredSlots: selectExpiredUploadSlots({
      now: options.now,
      slots: options.state.slots,
    }),
    ...retainedCoordinatorCursorFields(options.state.cursor, options.state),
  };
}

function retainedCoordinatorCursorFields(
  cursor: Cursor | undefined,
  state: CoordinatorPipelineState
): Pick<CoordinatorRetentionPlan, "cursor" | "retiredObjects"> {
  if (cursor === undefined) {
    return { retiredObjects: [] };
  }

  return {
    cursor,
    retiredObjects: retainedCoordinatorObjects(
      state.commits,
      cursor.committedWindow
    ),
  };
}

function retainedCoordinatorObjects(
  commits: CoordinatorPipelineState["commits"],
  retainedWindow: CommittedWindow
): CoordinatorRetentionPlan["retiredObjects"] {
  return selectRetiredCommittedObjects({
    commits,
    retainedWindow,
  });
}
