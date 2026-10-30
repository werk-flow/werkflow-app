import type { Json } from './database.types';

/** A JSON object: not null, not an array. */
export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A `jsonb` payload as an object to read keys from; any other JSON value reads as an empty object. */
export function jsonRecordOrEmpty(value: unknown): Record<string, unknown> {
  return isJsonRecord(value) ? value : {};
}

/** The value as it is stored in a `jsonb` column: `undefined` properties dropped, dates as ISO strings. */
export function toJson(value: unknown): Json {
  // JSON.parse is typed `any`; a JSON round trip yields a JSON value by construction.
  return JSON.parse(JSON.stringify(value));
}
