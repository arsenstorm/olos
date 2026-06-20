const URL_SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/;

export function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

export function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

export function assertNonNegativeInteger(
  value: unknown,
  name: string
): asserts value is number {
  if (isNonNegativeInteger(value)) {
    return;
  }

  throw new Error(`${name} must be a non-negative integer`);
}

export function assertPositiveInteger(
  value: unknown,
  name: string
): asserts value is number {
  if (isPositiveInteger(value)) {
    return;
  }

  throw new Error(`${name} must be a positive integer`);
}

export function isUrlSafeIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    URL_SAFE_IDENTIFIER_PATTERN.test(value)
  );
}

export function assertUrlSafeIdentifier(
  value: unknown,
  name: string
): asserts value is string {
  if (isUrlSafeIdentifier(value)) {
    return;
  }

  throw new Error(`${name} must be a non-empty URL-safe identifier`);
}
