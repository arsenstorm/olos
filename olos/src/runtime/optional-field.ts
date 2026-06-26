export function optionalField<Key extends string, Value>(
  key: Key,
  value: Value | undefined
): Partial<Record<Key, Value>> {
  const fields: Partial<Record<Key, Value>> = {};

  if (value !== undefined) {
    fields[key] = value;
  }

  return fields;
}
