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
  if (isParsedRuntimeJsonRequestValue<Value>(request)) {
    return parsedRuntimeJsonRequestValue(request);
  }

  return await parsedRuntimeJsonRequestBody(
    request,
    parsePayload,
    invalid,
    fallbackMessage
  );
}

function parsedRuntimeJsonRequestValue<Value, Invalid>(
  value: Value
): RuntimeJsonRequestParse<Value, Invalid> {
  return validRuntimeJsonRequestParse(value);
}

async function parsedRuntimeJsonRequestBody<Value, Invalid>(
  request: Request,
  parsePayload: (value: unknown) => Value,
  invalid: (message: string) => Invalid,
  fallbackMessage: string
): Promise<RuntimeJsonRequestParse<Value, Invalid>> {
  try {
    return validRuntimeJsonRequestParse(parsePayload(await request.json()));
  } catch (error) {
    return invalid(errorMessage(error, fallbackMessage));
  }
}

function isParsedRuntimeJsonRequestValue<Value>(
  request: Request | Value
): request is Value {
  return !(request instanceof Request);
}

function validRuntimeJsonRequestParse<Value, Invalid>(
  value: Value
): RuntimeJsonRequestParse<Value, Invalid> {
  return { status: "valid", value };
}
