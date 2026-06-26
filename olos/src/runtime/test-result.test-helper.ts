export function assertInvalidResult<
  TResult extends { response: Response; status: string },
>(result: TResult): Extract<TResult, { status: "invalid" }> {
  if (result.status !== "invalid") {
    throw new Error("expected invalid result");
  }

  if (result.response.status !== 400) {
    throw new Error("expected invalid result response status 400");
  }

  return result as Extract<TResult, { status: "invalid" }>;
}

export function invalidResultMessage<
  TResult extends { response: Response; status: string },
>(result: TResult): string {
  const invalidResult = assertInvalidResult(result) as Extract<
    TResult,
    { status: "invalid" }
  > & { message: string };

  return invalidResult.message;
}
