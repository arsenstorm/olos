// biome-ignore-all lint/performance/noBarrelFile: public S3 facade for the olos/s3 export

export {
  type CommitS3CoordinatorUploadOptions,
  type CommitStoredS3CoordinatorUploadOptions,
  type CompleteStoredS3CoordinatorUploadByObjectKeyOptions,
  type CompleteStoredS3CoordinatorUploadOptions,
  commitS3CoordinatorUpload,
  commitStoredS3CoordinatorUpload,
  completeStoredS3CoordinatorUpload,
  completeStoredS3CoordinatorUploadByObjectKey,
  type IssueS3CoordinatorUploadGrantOptions,
  type IssueStoredS3CoordinatorUploadGrantOptions,
  issueS3CoordinatorUploadGrant,
  issueStoredS3CoordinatorUploadGrant,
  type S3CoordinatorUploadGrantIssue,
  type StoredS3CoordinatorUploadCommit,
  type StoredS3CoordinatorUploadCompletion,
  type StoredS3CoordinatorUploadGrantIssue,
} from "./s3/coordinator";
export {
  type CreateObservedUploadFromS3HeadObjectOptions,
  createObservedUploadFromS3HeadObject,
  type ObserveS3ObjectOptions,
  observeS3Object,
  type S3HeadObjectClient,
} from "./s3/object-observation";
export {
  type CreatePresignedS3UploadGrantOptions,
  type CreateS3UploadGrantOptions,
  createPresignedS3UploadGrant,
  createS3UploadGrant,
} from "./s3/upload-grant";
