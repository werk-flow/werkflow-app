import { isValidIsoDate } from '@/lib/calendar/date-range';
import { isJsonRecord } from '@/lib/supabase/json';

/** Narrows a value the period sources guarantee; a missing one stops the action with its named error. */
export function requirePresent<Value>(value: Value | null | undefined, errorCode: string): Value {
  if (value === null || value === undefined) throw new Error(errorCode);
  return value;
}

/** A stored snapshot object; any other value stops the action with its named error. */
export function requireJsonRecord(value: unknown, errorCode: string): Record<string, unknown> {
  if (!isJsonRecord(value)) throw new Error(errorCode);
  return value;
}

export function isValidOptionalIsoDateRange(validFrom: string, validUntil: string): boolean {
  return (
    isValidIsoDate(validFrom) && (!validUntil || (isValidIsoDate(validUntil) && validUntil >= validFrom))
  );
}
