const URL_SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Returns whether `value` is a safe integer >= 0. Wire integers must stay
 * within `Number.MAX_SAFE_INTEGER` — JSON numbers above it lose precision
 * before any bound can be compared, so the unsafe range is always rejected.
 */
export function isNonNegativeInteger(value: unknown): value is number {
  return isIntegerAtLeast(value, 0);
}

export function isPositiveInteger(value: unknown): value is number {
  return isIntegerAtLeast(value, 1);
}

/** Alias of `isNonNegativeInteger` — every integer check is safe-bounded. */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return isIntegerAtLeast(value, 0);
}

/** Alias of `isPositiveInteger` — every integer check is safe-bounded. */
export function isPositiveSafeInteger(value: unknown): value is number {
  return isIntegerAtLeast(value, 1);
}

/**
 * Throws `Error("<name> must be a non-negative integer")` unless `value` is
 * an integer >= 0.
 */
export function assertNonNegativeInteger(
  value: unknown,
  name: string
): asserts value is number {
  assertInteger(value, name, isNonNegativeInteger, "non-negative");
}

export function assertPositiveInteger(
  value: unknown,
  name: string
): asserts value is number {
  assertInteger(value, name, isPositiveInteger, "positive");
}

export function assertNonNegativeSafeInteger(
  value: unknown,
  name: string
): asserts value is number {
  assertInteger(value, name, isNonNegativeSafeInteger, "non-negative");
}

export function assertPositiveSafeInteger(
  value: unknown,
  name: string
): asserts value is number {
  assertInteger(value, name, isPositiveSafeInteger, "positive");
}

function isIntegerAtLeast(value: unknown, minimum: number): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
  );
}

function assertInteger(
  value: unknown,
  name: string,
  isValid: (value: unknown) => value is number,
  description: "non-negative" | "positive"
): asserts value is number {
  if (isValid(value)) {
    return;
  }

  throw new Error(`${name} must be a ${description} integer`);
}

/**
 * Returns whether `value` is a non-empty string of URL-safe identifier
 * characters (`[A-Za-z0-9._-]`) — the character set every `OlosId` must
 * use.
 */
export function isUrlSafeIdentifier(value: unknown): value is string {
  return isNonEmptyString(value) && hasUrlSafeIdentifierCharacters(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasUrlSafeIdentifierCharacters(value: string): boolean {
  return URL_SAFE_IDENTIFIER_PATTERN.test(value);
}

/**
 * Throws `Error("<name> must be a non-empty URL-safe identifier")` unless
 * `value` satisfies `isUrlSafeIdentifier`.
 */
export function assertUrlSafeIdentifier(
  value: unknown,
  name: string
): asserts value is string {
  if (isUrlSafeIdentifier(value)) {
    return;
  }

  throw new Error(`${name} must be a non-empty URL-safe identifier`);
}
