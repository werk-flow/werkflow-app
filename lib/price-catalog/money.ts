// Euro amounts as the office types and reads them. An amount is integer
// cents; typed text never passes through a float.

/** The largest price a version stores, as the database checks it: one million euros. */
export const MAX_PRICE_CENTS = 100_000_000;

// With a decimal comma, dots group thousands: „1.234,56“, „1234,5“. Without
// one, a dot is the decimal point: „1234.56“, „1234“.
const GROUPED_WITH_COMMA = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})$/;
const PLAIN_WITH_DOT = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Cents of a typed non-negative euro amount: `null` for empty text,
 * `undefined` for text that is no such amount or exceeds `MAX_PRICE_CENTS`.
 * „1.234“ is refused: it reads as 1234 € and as 1,234 €.
 */
export function parseEuroCents(value: string): number | null | undefined {
  const text = value.trim().replace(/\s*€$/, '');
  if (text === '') return null;
  const match = text.includes(',') ? GROUPED_WITH_COMMA.exec(text) : PLAIN_WITH_DOT.exec(text);
  if (!match) return undefined;
  const [, whole = '0', fraction = ''] = match;
  const cents = Number(whole.replaceAll('.', '')) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= MAX_PRICE_CENTS ? cents : undefined;
}

/** The text an amount field starts with: „1234,50“. */
export function centsToEuroInput(cents: number | null): string {
  if (cents === null) return '';
  const whole = Math.trunc(cents / 100);
  const fraction = String(Math.abs(cents % 100)).padStart(2, '0');
  return `${whole},${fraction}`;
}
