import { createHlsManifestArtifacts } from "../hls/manifest-artifacts";
import {
  selectExpiredUploadSlots,
  selectRetiredCommittedObjects,
} from "../state/retention";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import { assertSession } from "../validation/session";
import type {
  CoordinatorManifestArtifacts,
  CoordinatorPipelineState,
  CoordinatorRetentionPlan,
  CreateCoordinatorManifestArtifactsOptions,
  PlanCoordinatorRetentionOptions,
} from "./coordinator";

export function createCoordinatorPipeline(options: {
  pathways: readonly Pathway[];
  session: Session;
}): CoordinatorPipelineState {
  assertSession(options.session);

  if (options.pathways.length === 0) {
    throw new Error("pathways must be a non-empty array");
  }

  return {
    commits: [],
    initCommits: [],
    pathways: [...options.pathways],
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
  const cursor = options.state.cursor;

  return {
    expiredSlots: selectExpiredUploadSlots({
      now: options.now,
      slots: options.state.slots,
    }),
    retiredObjects:
      cursor === undefined
        ? []
        : selectRetiredCommittedObjects({
            commits: options.state.commits,
            retainedWindow: cursor.committedWindow,
          }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}
