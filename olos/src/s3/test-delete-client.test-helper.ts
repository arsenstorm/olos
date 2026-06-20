import type {
  DeleteObjectCommand,
  DeleteObjectCommandOutput,
} from "@aws-sdk/client-s3";
import type { S3DeleteObjectClient } from "./retention";

export function createTestS3DeleteObjectClient(
  inputs: unknown[],
  failingKey?: string
): S3DeleteObjectClient {
  return {
    send(command: DeleteObjectCommand): Promise<DeleteObjectCommandOutput> {
      inputs.push(command.input);

      if (command.input.Key === failingKey) {
        throw new Error("delete failed");
      }

      return Promise.resolve({ $metadata: {} });
    },
  };
}
