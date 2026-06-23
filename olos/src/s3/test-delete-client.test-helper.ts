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
      recordDeleteObjectInput(inputs, command);

      if (isFailingDeleteKey(command, failingKey)) {
        throw new Error("delete failed");
      }

      return Promise.resolve({ $metadata: {} });
    },
  };
}

function recordDeleteObjectInput(
  inputs: unknown[],
  command: DeleteObjectCommand
): void {
  inputs.push(command.input);
}

function isFailingDeleteKey(
  command: DeleteObjectCommand,
  failingKey: string | undefined
): boolean {
  return command.input.Key === failingKey;
}
