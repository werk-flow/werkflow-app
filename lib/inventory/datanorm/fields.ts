import { isValidIsoDate } from '@/lib/calendar/date-range';
import type {
  DatanormDiscount,
  DatanormHeader,
  DatanormPriceKind,
  DatanormPriceQuantity,
} from '@/lib/inventory/datanorm/types';

// Field values of DATANORM 4, read from public descriptions (sources in
// read-delivery.ts). Amounts carry no decimal separator: a price is whole
// cents, a rebate is whole hundredths of a percent. They are parsed from
// their digits, never through a float.

/** A field read, or the rejected value that stops the line. */
export type FieldRead<T> = { ok: true; value: T } | { ok: false; written: string };

const MAX_AMOUNT_DIGITS = 12;
const HEADER_LENGTH = 128;

/** A whole number written in digits; empty is null. Leading zeros and padding spaces are allowed. */
export function wholeNumberField(written: string): FieldRead<number | null> {
  const digits = written.trim();
  if (digits === '') return { ok: true, value: null };
  if (!/^\d+$/.test(digits) || digits.replace(/^0+/, '').length > MAX_AMOUNT_DIGITS)
    return { ok: false, written };
  return { ok: true, value: Number.parseInt(digits, 10) };
}

/** The price-unit code: a power of ten from 0 (per 1) to 3 (per 1000). */
export const PRICE_QUANTITY_CODES: ReadonlyMap<string, DatanormPriceQuantity> = new Map([
  ['0', 1],
  ['1', 10],
  ['2', 100],
  ['3', 1000],
]);

export const PRICE_KIND_CODES: ReadonlyMap<string, DatanormPriceKind> = new Map([
  ['1', 'list'],
  ['2', 'net'],
]);

/** A code looked up in its table; a Map, so no inherited property ever counts as a code. */
export function codeField<T>(codes: ReadonlyMap<string, T>, written: string): FieldRead<T> {
  const value = codes.get(written.trim());
  return value === undefined ? { ok: false, written } : { ok: true, value };
}

/**
 * A rebate as a price or rebate-group record writes it: code 0 names a rebate
 * group, code 1 a percentage in hundredths. Codes 2 (multiplier) and 3
 * (surcharge) stay as written, because public descriptions leave their
 * decimals open. An empty code with an empty value is no rebate.
 */
export function discountField(code: string, value: string): FieldRead<DatanormDiscount | null> {
  const trimmedCode = code.trim();
  const trimmedValue = value.trim();
  if (trimmedCode === '' && trimmedValue === '') return { ok: true, value: null };
  if (trimmedCode === '0') return { ok: true, value: { kind: 'rebate_group', rebateGroup: trimmedValue } };
  if (trimmedCode !== '1')
    return { ok: true, value: { kind: 'unread', code: trimmedCode, value: trimmedValue } };
  const percent = wholeNumberField(value);
  if (!percent.ok || percent.value === null) return { ok: false, written: value };
  return { ok: true, value: { kind: 'percent', hundredthsOfPercent: percent.value } };
}

export type HeaderRead =
  | { kind: 'header'; header: DatanormHeader }
  | { kind: 'version_unsupported'; version: string }
  | { kind: 'not_a_header' };

/**
 * The DATANORM 4 header is one fixed-width line of 128 characters without
 * field separators: "V", a space, the date as DDMMYY, free text, then the
 * version "04" and the currency code in the last five characters. A
 * DATANORM 5 header separates its fields with semicolons instead, starting
 * "V;050;".
 */
export function readHeader(line: string): HeaderRead {
  if (!line.startsWith('V')) return { kind: 'not_a_header' };
  const fields = line.split(';');
  if (fields.length > 1 && fields[0]?.trim() === 'V')
    return { kind: 'version_unsupported', version: fields[1]?.trim() ?? '' };
  const padded = line.padEnd(HEADER_LENGTH, ' ');
  const version = padded.slice(HEADER_LENGTH - 5, HEADER_LENGTH - 3);
  if (version !== '04') return { kind: 'version_unsupported', version: version.trim() };
  return {
    kind: 'header',
    header: {
      version,
      supplierText: padded
        .slice(8, HEADER_LENGTH - 5)
        .replace(/\s+/g, ' ')
        .trim(),
      date: headerDate(padded.slice(2, 8)),
      currency: padded.slice(HEADER_LENGTH - 3).trim(),
    },
  };
}

// DATANORM 4 dates from 1994, so a two-digit year from 94 is in the 1900s
// and every other one in the 2000s.
const FIRST_YEAR_OF_FORMAT = 94;

function headerDate(written: string): string | null {
  const match = /^(\d{2})(\d{2})(\d{2})$/.exec(written);
  if (!match) return null;
  const [, day = '', month = '', shortYear = ''] = match;
  const year = (Number(shortYear) >= FIRST_YEAR_OF_FORMAT ? 1900 : 2000) + Number(shortYear);
  const iso = `${year}-${month}-${day}`;
  return isValidIsoDate(iso) ? iso : null;
}
