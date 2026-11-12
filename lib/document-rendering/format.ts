// German print formats for the renderer. Every value arrives as an integer or
// a decimal string, so no float ever rounds a printed amount.

const groupedInteger = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

function grouped(digits: string): string {
  return groupedInteger.format(BigInt(digits));
}

/** `-123456` → `-1.234,56 €`. */
export function formatEuroCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error('document_amount_not_integer_cents');
  const absolute = Math.abs(cents);
  const euros = grouped(String(Math.trunc(absolute / 100)));
  const rest = String(absolute % 100).padStart(2, '0');
  return `${cents < 0 ? '-' : ''}${euros},${rest} €`;
}

const QUANTITY = /^(-?)(\d+)(?:\.(\d{1,3}))?$/;

/** `1234.500` → `1.234,5`; at most three decimals, as a quantity is stored. */
export function formatQuantity(quantity: string): string {
  const match = QUANTITY.exec(quantity);
  if (!match) throw new Error('document_quantity_not_decimal');
  const [, sign = '', whole = '0', decimals = ''] = match;
  const fraction = decimals.replace(/0+$/, '');
  return `${sign}${grouped(whole)}${fraction ? `,${fraction}` : ''}`;
}

/** `1900` → `19 %`, `750` → `7,5 %`. */
export function formatTaxRate(basisPoints: number): string {
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) throw new Error('document_tax_rate_invalid');
  const fraction = String(basisPoints % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return `${Math.trunc(basisPoints / 100)}${fraction ? `,${fraction}` : ''} %`;
}
