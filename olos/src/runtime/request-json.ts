import { errorMessage } from "./errors";

export type RuntimeJsonRequestParse<Value, Invalid> =
  | { status: "valid"; value: Value }
  | Invalid;

export async function parseRuntimeJsonRequest<Value, Invalid>(
  request: Request | Value,
  parsePayload: (value: unknown) => Value,
  invalid: (message: string) => Invalid,
  fallbackMessage: string
): Promise<RuntimeJsonRequestParse<Value, Invalid>> {
  if (!(request instanceof Request)) {
    return { status: "valid", value: request };
  }

  try {
    return { status: "valid", value: parsePayload(await request.json()) };
  } catch (error) {
    return invalid(errorMessage(error, fallbackMessage));
  }
}
