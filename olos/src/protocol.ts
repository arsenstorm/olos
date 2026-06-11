// biome-ignore-all lint/performance/noBarrelFile: public protocol facade for the olos/protocol export

export const OLOS_PROTOCOL_NAME = "Open Live Object Streaming";
export const OLOS_PROTOCOL_SHORT_NAME = "OLOS";
export const OLOS_SPEC_STATUS = "draft-v0.1.2";
export const OLOS_WIRE_VERSION = "1.0";
export {
  type CommitCoordinatorUploadOptions,
  type CoordinatorPipelineState,
  type CoordinatorSlotIssue,
  type CoordinatorUploadCommit,
  type CreateCoordinatorPipelineOptions,
  commitCoordinatorUpload,
  createCoordinatorPipeline,
  type IssueCoordinatorSlotOptions,
  issueCoordinatorSlot,
} from "./protocol/coordinator";
