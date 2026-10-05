/** Fails the test with a readable message when a value it relies on is missing, instead of a `!` assertion. */
export function expectDefined<Value>(value: Value | null | undefined, description = 'value'): Value {
  if (value === null || value === undefined) throw new Error(`Expected ${description} to be defined.`);
  return value;
}
