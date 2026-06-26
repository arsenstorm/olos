import type { GetObjectCommandOutput, S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";

const MEDIA_PREFIX = "/media/";

export async function proxyMediaObject(
  request: Request,
  env: Env,
  client: S3Client
): Promise<Response> {
  const url = new URL(request.url);
  const objectKey = url.pathname.slice(MEDIA_PREFIX.length);

  if (objectKey === "" || objectKey.includes("..")) {
    return new Response("invalid object key", { status: 400 });
  }

  let object: GetObjectCommandOutput;
  try {
    object = await client.send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey })
    );
  } catch (error) {
    if (error instanceof NoSuchKey) {
      return new Response("not found", { status: 404 });
    }
    throw error;
  }

  if (object.Body === undefined) {
    return new Response("not found", { status: 404 });
  }

  return new Response(object.Body.transformToWebStream(), {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": object.ContentType ?? "application/octet-stream",
    },
  });
}
