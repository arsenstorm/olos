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
  type CoordinatorSlotIssue,
  type CoordinatorStoreSave,
  type CoordinatorUploadCommit,
  type CreateCoordinatorManifestArtifactsOptions,
  type CreateCoordinatorPipelineOptions,
  commitCoordinatorUpload,
  createCoordinatorManifestArtifacts,
  createCoordinatorPipeline,
  createMemoryCoordinatorStore,
  type IssueCoordinatorSlotOptions,
  issueCoordinatorSlot,
  type MutateCoordinatorPipelineOptions,
  mutateCoordinatorPipeline,
  type SaveCoordinatorPipelineOptions,
} from "./protocol/coordinator";
