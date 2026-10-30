import type { Json } from './database.types';

/** A JSON object: not null, not an array. */
export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A `jsonb` payload as an object to read keys from; any other JSON value reads as an empty object. */
export function jsonRecordOrEmpty(value: unknown): Record<string, unknown> {
  return isJsonRecord(value) ? value : {};
}

/** A value of the JSON data model: what `JSON.parse` returns. */
function isJsonValue(value: unknown): value is Json {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonRecord(value) && Object.values(value).every(isJsonValue);
}

/** The value as it is stored in a `jsonb` column: `undefined` properties dropped, dates as ISO strings. */
export function toJson(value: unknown): Json {
  const stored: unknown = JSON.parse(JSON.stringify(value));
  // Unreachable: a JSON round trip yields a JSON value; the guard proves it to the compiler.
  if (!isJsonValue(stored)) throw new TypeError('toJson: the round trip did not yield a JSON value');
  return stored;
}
