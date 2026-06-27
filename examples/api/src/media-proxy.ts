import type { S3GetObjectClient } from "@arsenstorm/olos/s3";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";

// URL path == S3 key. The 0.4.0 coordinator's derived objectKey includes
// the `media/` prefix, and the manifest's deliveryUrl is
// `${mediaBaseUrl}/${objectKey}` — so `/media/v1080/s3810.m4s` in the URL
// is `media/v1080/s3810.m4s` in S3, verbatim.
export async function proxyMediaObject(
  request: Request,
  env: Env,
  client: S3GetObjectClient
): Promise<Response> {
  const url = new URL(request.url);
  const objectKey = url.pathname.slice(1);

  if (objectKey === "" || objectKey.includes("..")) {
    return new Response("invalid object key", { status: 400 });
  }

  let object: GetObjectCommandOutput;
  try {
    object = await client.send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey })
    );
  } catch (error) {
    if (error instanceof NoSuchKey || (error as Error)?.name === "NoSuchKey") {
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
