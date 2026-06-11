// biome-ignore-all lint/performance/noBarrelFile: public S3 facade for the olos/s3 export

export {
  type CreateS3ProviderCapabilityOptions,
  createR2ProviderCapability,
  createS3ProviderCapability,
  S3_UPLOAD_GRANT_REQUIRED_HEADERS,
} from "./s3/capability";
export {
  type CreateS3UploadGrantOptions,
  createS3UploadGrant,
} from "./s3/upload-grant";
