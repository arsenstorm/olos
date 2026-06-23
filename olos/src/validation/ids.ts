const URL_SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/;

interface IntegerPredicateOptions {
  safe?: boolean;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return isIntegerAtLeast(value, 0);
}

export function isPositiveInteger(value: unknown): value is number {
  return isIntegerAtLeast(value, 1);
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
  return isIntegerAtLeast(value, 0, { safe: true });
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return isIntegerAtLeast(value, 1, { safe: true });
}

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

function isIntegerAtLeast(
  value: unknown,
  minimum: number,
  options: IntegerPredicateOptions = {}
): value is number {
  return isIntegerValue(value, options) && value >= minimum;
}

function isIntegerValue(
  value: unknown,
  options: IntegerPredicateOptions
): value is number {
  return options.safe ? Number.isSafeInteger(value) : Number.isInteger(value);
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

export function isUrlSafeIdentifier(value: unknown): value is string {
  return isNonEmptyString(value) && hasUrlSafeIdentifierCharacters(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasUrlSafeIdentifierCharacters(value: string): boolean {
  return URL_SAFE_IDENTIFIER_PATTERN.test(value);
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
