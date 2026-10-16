/**
 * A text column narrowed to the values its database check constraint allows. Another value
 * means the schema and the code drifted apart, which no read may hide, so it throws.
 */
export function constrainedValue<Value extends string>(
  allowed: readonly Value[],
  value: string,
  column: string,
): Value {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw new Error(`Unexpected ${column}: ${value}`);
  return match;
}
