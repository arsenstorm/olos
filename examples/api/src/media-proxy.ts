import type { S3GetObjectClient } from "@arsenstorm/olos/s3";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";

// URL path == S3 key. The coordinator's derived objectKey includes the
// `objects/` prefix, and the manifest's deliveryUrl is
// `${deliveryBaseUrl}/${objectKey}` — so `/objects/v1080/s3810.m4s` in the
// URL is `objects/v1080/s3810.m4s` in S3, verbatim.
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

  const object = await getObjectOrUndefined(client, env.S3_BUCKET, objectKey);

  if (object?.Body === undefined) {
    return new Response("not found", { status: 404 });
  }

  return new Response(object.Body.transformToWebStream(), {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": object.ContentType ?? "application/octet-stream",
    },
  });
}

function getObjectOrUndefined(
  client: S3GetObjectClient,
  bucket: string,
  key: string
): Promise<GetObjectCommandOutput | undefined> {
  return client
    .send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    .catch(undefinedIfNoSuchKey);
}

function undefinedIfNoSuchKey(error: unknown): undefined {
  if (error instanceof NoSuchKey || (error as Error)?.name === "NoSuchKey") {
    return;
  }
  throw error;
}
