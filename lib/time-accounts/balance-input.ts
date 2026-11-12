/**
 * A balance as the office writes it: hours and minutes with an optional
 * sign, „+12:30“, „-3:15“ or „0:00“, the form `formatMinutes` shows. The
 * typographic minus „−“ and a trailing „Std.“ are accepted, so a value
 * copied from a balance reads back. Plain minutes are refused: „750“ could
 * mean 750 hours or 12:30 hours, and a balance is money.
 */
const BALANCE_PATTERN = /^([+\-−]?)\s*(\d{1,4}):([0-5]\d)(?:\s*Std\.?)?$/;

/** The signed minutes of a typed balance, or null when it is no „±HH:MM“. */
export function parseSignedHoursMinutes(input: string): number | null {
  const match = BALANCE_PATTERN.exec(input.trim());
  if (!match) return null;
  const [, sign, hours, minutes] = match;
  const total = Number(hours) * 60 + Number(minutes);
  if (total === 0) return 0;
  return sign === '-' || sign === '−' ? -total : total;
}

/** The prefilled balance of an account to open. */
export const ZERO_BALANCE_INPUT = '0:00';

export const BALANCE_INPUT_ERROR = 'Gib den Saldo als Std:Min an, etwa +12:30 oder -3:15.';
