import type { Json } from './database.types';

/** A JSON object: not null, not an array. */
export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value as it is stored in a `jsonb` column: `undefined` properties dropped, dates as ISO strings. */
export function toJson(value: unknown): Json {
  // JSON.parse returns `any`; its output is by construction a Json value.
  return JSON.parse(JSON.stringify(value)) as Json;
}
