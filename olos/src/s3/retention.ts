import {
  DeleteObjectCommand,
  type DeleteObjectCommandOutput,
} from "@aws-sdk/client-s3";
import {
  deleteRetiredCoordinatorObjects,
  type RetiredCoordinatorObjectDeletion,
  type RetiredCoordinatorObjectDeletionResult,
} from "../runtime/retention";

export interface S3DeleteObjectClient {
  send(command: DeleteObjectCommand): Promise<DeleteObjectCommandOutput>;
}

export interface DeleteRetiredS3CoordinatorObjectsOptions {
  bucket: string;
  client: S3DeleteObjectClient;
  objects: readonly RetiredCoordinatorObjectDeletion[];
}

export async function deleteRetiredS3CoordinatorObjects(
  options: DeleteRetiredS3CoordinatorObjectsOptions
): Promise<RetiredCoordinatorObjectDeletionResult> {
  return await deleteRetiredCoordinatorObjects({
    deleteObject: async (object) => {
      await options.client.send(
        new DeleteObjectCommand({
          Bucket: options.bucket,
          Key: object.objectKey,
        })
      );
    },
    objects: options.objects,
  });
}
