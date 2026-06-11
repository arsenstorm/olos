// biome-ignore-all lint/performance/noBarrelFile: public state facade for the olos/state export

export {
  type CommitObservedUploadOptions,
  type CommitObservedUploadResult,
  type CreateCommitOptions,
  commitObservedUpload,
  createCommit,
  type DuplicateCommitResolution,
  type ResolveDuplicateCommitOptions,
  resolveDuplicateCommit,
} from "./state/commit";
export {
  type CreateCommittedWindowOptions,
  createCommittedWindow,
} from "./state/committed-window";
export {
  type CreateCursorOptions,
  type CursorUpdateResolution,
  createCursor,
  type ResolveCursorUpdateOptions,
  resolveCursorUpdate,
} from "./state/cursor";
export {
  type CreateObservedUploadFromHeadObjectOptions,
  type CreateObservedUploadFromObjectCreatedEventOptions,
  type CreateObservedUploadOptions,
  createObservedUpload,
  createObservedUploadFromHeadObject,
  createObservedUploadFromObjectCreatedEvent,
  OBJECT_CREATED_EVENT_TYPE,
  type ObservedUploadObjectCreatedEvent,
} from "./state/observed-upload";
export {
  type PathwayFailoverResolution,
  type ResolvePathwayFailoverOptions,
  resolvePathwayFailover,
} from "./state/pathway";
export {
  assertProviderCanIssueUploadGrant,
  canProviderIssueUploadGrant,
  type ProviderUploadGrantPolicyOptions,
} from "./state/provider-upload-grant-policy";
export { assertSessionTransition, canTransitionSession } from "./state/session";
export {
  type CreateUploadGrantOptions,
  createUploadGrant,
} from "./state/upload-grant";
export {
  assertUploadSlotTransition,
  type CreateIssuedUploadSlotOptions,
  canTransitionUploadSlot,
  createIssuedUploadSlot,
  type ObserveUploadOptions,
  observeUpload,
} from "./state/upload-slot";
