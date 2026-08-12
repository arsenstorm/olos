// biome-ignore-all lint/performance/noBarrelFile: public S3 facade for the olos/s3 export

export { createByterangeSegmentResponse } from "./s3/byterange-response";
export type {
  ByterangeCursorWait,
  ByterangeCursorWaitContext,
  ByterangeRangeRequest,
  CreateByterangeSegmentResponseOptions,
  S3GetObjectClient,
} from "./s3/byterange-types";
export {
  applyS3RuntimeRetention,
  commitS3RuntimeUpload,
  completeS3RuntimeUpload,
  issueS3RuntimeUploadGrant,
  planS3RuntimeReconciliation,
  reconcileS3RuntimeUploads,
  type S3RuntimeApplyRetentionOptions,
  type S3RuntimeApplyRetentionResponse,
  type S3RuntimeCommitPayload,
  type S3RuntimeCommitUploadOptions,
  type S3RuntimeCommitUploadResponse,
  type S3RuntimeCompleteUploadOptions,
  type S3RuntimeCompleteUploadResponse,
  type S3RuntimeCompletionHintPayload,
  type S3RuntimeHttpClientOptions,
  type S3RuntimeIssueUploadGrantOptions,
  type S3RuntimeIssueUploadGrantResponse,
  type S3RuntimePlanReconciliationOptions,
  type S3RuntimeReconcileUploadsOptions,
  type S3RuntimeReconcileUploadsResponse,
  type S3RuntimeReconciliationPayload,
  type S3RuntimeReconciliationPlanPayload,
  type S3RuntimeReconciliationPlanResponse,
  type S3RuntimeRetentionPayload,
} from "./s3/client";
export { S3RuntimeHttpError } from "./s3/client-error";
export {
  completeStoredS3CoordinatorUpload,
  completeStoredS3CoordinatorUploadByObjectKey,
  routeStoredS3CoordinatorUploadEvent,
} from "./s3/coordinator-event";
export {
  commitS3CoordinatorUpload,
  commitStoredS3CoordinatorUpload,
  issueS3CoordinatorUploadGrant,
  issueStoredS3CoordinatorUploadGrant,
} from "./s3/coordinator-grant";
export type {
  CommitS3CoordinatorUploadOptions,
  CommitStoredS3CoordinatorUploadOptions,
  CompleteStoredS3CoordinatorUploadByObjectKeyOptions,
  CompleteStoredS3CoordinatorUploadOptions,
  IssueS3CoordinatorUploadGrantOptions,
  IssueStoredS3CoordinatorUploadGrantOptions,
  RouteStoredS3CoordinatorUploadEventOptions,
  S3CoordinatorUploadGrantIssue,
  StoredS3CoordinatorManifest,
  StoredS3CoordinatorManifestArtifact,
  StoredS3CoordinatorManifestOptions,
  StoredS3CoordinatorUploadAuditEvent,
  StoredS3CoordinatorUploadCommit,
  StoredS3CoordinatorUploadCompletion,
  StoredS3CoordinatorUploadEventRoute,
  StoredS3CoordinatorUploadGrantIssue,
} from "./s3/coordinator-types";
export {
  type NormalizeS3ObjectCreatedEventRecordOptions,
  type NormalizeS3ObjectCreatedEventsOptions,
  normalizeS3ObjectCreatedEventRecord,
  normalizeS3ObjectCreatedEvents,
} from "./s3/event";
export {
  createStoredS3CoordinatorRuntimeHandler,
  type StoredS3CoordinatorRuntimeHandler,
} from "./s3/http";
export type {
  CreateStoredS3CoordinatorRuntimeHandlerOptions,
  StoredS3CoordinatorCommitResponse,
  StoredS3CoordinatorEventRouteResponse,
  StoredS3CoordinatorEventRouteResponseResult,
  StoredS3CoordinatorReconciliationResponse,
  StoredS3CoordinatorReconciliationResponseResult,
  StoredS3CoordinatorRetentionResponse,
  StoredS3CoordinatorRouteError,
  StoredS3CoordinatorSlotGrantResponse,
} from "./s3/http-types";
export {
  type CreateObservedUploadFromS3HeadObjectOptions,
  createObservedUploadFromS3HeadObject,
  type ObserveS3ObjectOptions,
  observeS3Object,
  type S3HeadObjectClient,
} from "./s3/object-observation";
export {
  runNextStoredS3PublisherUploadStep,
  runPlannedStoredS3PublisherUploadStep,
  runStoredS3PublisherUploadStep,
} from "./s3/publisher";
export { summarizeStoredS3PublisherUploadStep } from "./s3/publisher-summary";
export type {
  NextStoredS3PublisherUploadStep,
  PlannedStoredS3PublisherUploadStep,
  RunNextStoredS3PublisherUploadStepOptions,
  RunPlannedStoredS3PublisherUploadStepOptions,
  RunStoredS3PublisherUploadStepOptions,
  StoredS3PublisherUploadStep,
  StoredS3PublisherUploadStepSummary,
} from "./s3/publisher-types";
export {
  type PlanStoredS3CoordinatorReconciliationOptions,
  planStoredS3CoordinatorReconciliation,
  type ReconcileStoredS3CoordinatorUploadsOptions,
  reconcileStoredS3CoordinatorUploads,
  type StoredS3CoordinatorReconciliationPlan,
  type StoredS3CoordinatorUploadReconciliation,
  type StoredS3CoordinatorUploadReconciliationResult,
  type StoredS3CoordinatorUploadReconciliationSummary,
  summarizeStoredS3CoordinatorUploadReconciliation,
} from "./s3/reconciliation";
export {
  type DeleteRetiredS3CoordinatorObjectsOptions,
  deleteRetiredS3CoordinatorObjects,
  type S3DeleteObjectClient,
} from "./s3/retention";
export {
  type CreatePresignedS3UploadGrantOptions,
  type CreateS3UploadGrantOptions,
  createPresignedS3UploadGrant,
  createS3UploadGrant,
} from "./s3/upload-grant";
