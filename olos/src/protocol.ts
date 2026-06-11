// biome-ignore-all lint/performance/noBarrelFile: public protocol facade for the olos/protocol export

export const OLOS_PROTOCOL_NAME = "Open Live Object Streaming";
export const OLOS_PROTOCOL_SHORT_NAME = "OLOS";
export const OLOS_SPEC_STATUS = "draft-v0.1.2";
export const OLOS_WIRE_VERSION = "1.0";
export {
  type CommitCoordinatorUploadOptions,
  type CoordinatorManifestArtifacts,
  type CoordinatorPipelineMutation,
  type CoordinatorPipelineSnapshot,
  type CoordinatorPipelineState,
  type CoordinatorPipelineStore,
  type CoordinatorRetentionPlan,
  type CoordinatorSlotIssue,
  type CoordinatorStoreSave,
  type CoordinatorUploadCommit,
  type CreateCoordinatorManifestArtifactsOptions,
  type CreateCoordinatorPipelineOptions,
  cloneCoordinatorPipelineSnapshot,
  cloneCoordinatorPipelineState,
  commitCoordinatorUpload,
  createCoordinatorManifestArtifacts,
  createCoordinatorPipeline,
  createMemoryCoordinatorStore,
  createNextCoordinatorPipelineEtag,
  type IssueCoordinatorSlotOptions,
  issueCoordinatorSlot,
  type MutateCoordinatorPipelineOptions,
  mutateCoordinatorPipeline,
  type PlanCoordinatorRetentionOptions,
  parseCoordinatorPipelineSnapshot,
  planCoordinatorRetention,
  type SaveCoordinatorPipelineOptions,
  serializeCoordinatorPipelineSnapshot,
} from "./protocol/coordinator";
export {
  createSerializedCoordinatorStore,
  type SaveSerializedCoordinatorStoreOptions,
  type SerializedCoordinatorStoreBackend,
  type SerializedCoordinatorStoreRecord,
  type SerializedCoordinatorStoreSave,
} from "./protocol/serialized-store";
