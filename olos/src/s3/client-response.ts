import { responseBody } from "../runtime/http-client";
import { S3RuntimeHttpError } from "./client-error";

async function s3RuntimeHttpError(
  operation: string,
  response: Response
): Promise<S3RuntimeHttpError> {
  return new S3RuntimeHttpError(
    `${operation} failed with status ${response.status}`,
    response,
    await responseBody(response)
  );
}

export async function parsedS3RuntimeResponse<Payload extends object>(
  response: Response,
  operation: string,
  parsePayload: (value: unknown) => Payload
): Promise<Payload & { response: Response }> {
  if (!response.ok) {
    throw await s3RuntimeHttpError(operation, response);
  }

  return {
    ...parsePayload(await response.json()),
    response,
  };
}
