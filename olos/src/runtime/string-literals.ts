export function isStringLiteral<const Values extends readonly string[]>(
  value: string,
  values: Values
): value is Values[number] {
  return values.some((candidate) => candidate === value);
}
