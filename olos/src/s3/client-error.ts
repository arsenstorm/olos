import { RuntimeHttpError } from "../runtime/client";

/**
 * Thrown by the `olos/s3` runtime client functions when the coordinator
 * responds with a non-2xx status. Exposes the failed `Response` and its
 * parsed body — for OLOS rejections the body carries an `error.code` with an
 * `olos.*` error code.
 */
export class S3RuntimeHttpError extends RuntimeHttpError {
  constructor(message: string, response: Response, body: unknown) {
    super(message, response, body);
    this.name = "S3RuntimeHttpError";
  }
}
