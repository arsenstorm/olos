export class S3RuntimeHttpError extends Error {
  readonly body: unknown;
  readonly response: Response;
  readonly status: number;

  constructor(message: string, response: Response, body: unknown) {
    super(message);
    this.body = body;
    this.name = "S3RuntimeHttpError";
    this.response = response;
    this.status = response.status;
  }
}
