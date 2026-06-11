// biome-ignore-all lint/performance/noBarrelFile: public S3 facade for the olos/s3 export

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
