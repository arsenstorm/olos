import {
  DeleteObjectCommand,
  type DeleteObjectCommandOutput,
} from "@aws-sdk/client-s3";
import {
  deleteRetiredCoordinatorObjects,
  type RetiredCoordinatorObjectDeletion,
  type RetiredCoordinatorObjectDeletionResult,
} from "../runtime/retention";
import { assertSafeObjectKey } from "../validation/object-key";
import { assertS3BucketName } from "./bucket";

/**
 * Narrowed S3 client surface used to delete retired objects. Lets callers
 * plug in a minimal wrapper rather than the full `@aws-sdk/client-s3`
 * `S3Client`.
 */
export interface S3DeleteObjectClient {
  send(command: DeleteObjectCommand): Promise<DeleteObjectCommandOutput>;
}

/** Options for {@link deleteRetiredS3CoordinatorObjects}. */
export interface DeleteRetiredS3CoordinatorObjectsOptions {
  bucket: string;
  client: S3DeleteObjectClient;
  /** Maximum deletes in flight at once (default 1). */
  concurrency?: number;
  /** Retired objects from a retention plan or commit result. */
  objects: readonly RetiredCoordinatorObjectDeletion[];
}

/**
 * Delete retired coordinator objects from S3. Each delete failure is
 * isolated and summarized — the returned result lists `deletedObjects` and
 * `failedObjects` (with error messages) in input order instead of throwing.
 * S3 deletes are idempotent against already-missing objects, so failed
 * entries can safely be retried by a later sweep. Throws only for an
 * invalid bucket or object key.
 */
export async function deleteRetiredS3CoordinatorObjects(
  options: DeleteRetiredS3CoordinatorObjectsOptions
): Promise<RetiredCoordinatorObjectDeletionResult> {
  assertS3BucketName(options.bucket);

  return await deleteRetiredCoordinatorObjects({
    ...(options.concurrency === undefined
      ? {}
      : { concurrency: options.concurrency }),
    deleteObject: (object) => deleteRetiredS3Object(options, object),
    objects: options.objects,
  });
}

async function deleteRetiredS3Object(
  options: Pick<DeleteRetiredS3CoordinatorObjectsOptions, "bucket" | "client">,
  object: RetiredCoordinatorObjectDeletion
): Promise<void> {
  assertSafeObjectKey(object.objectKey, "objectKey");

  await options.client.send(
    new DeleteObjectCommand({
      Bucket: options.bucket,
      Key: object.objectKey,
    })
  );
}
