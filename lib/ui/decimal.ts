/**
 * Shared de-DE decimal input handling for numeric controls
 * (QuantityStepper, DurationHoursInput). Users type comma decimals;
 * the app stores dot decimals.
 */

/** Keep only digits and a single decimal separator, normalizing ',' to '.'. */
export function sanitizeDecimalInput(value: string): string {
  const normalized = value.replace(',', '.');
  let result = '';
  let hasDot = false;

  for (const char of normalized) {
    if (char >= '0' && char <= '9') {
      result += char;
      continue;
    }

    if (char === '.' && !hasDot) {
      result += char;
      hasDot = true;
    }
  }

  return result;
}

/**
 * Parse a comma- or dot-decimal string; returns 0 for unparseable input.
 * With a decimal comma, dots are thousands separators: „1.234,5“ is 1234.5,
 * not 0.
 */
export function parseDecimalInput(value: string): number {
  const trimmed = value.trim();
  const normalized = trimmed.includes(',') ? trimmed.replaceAll('.', '').replace(',', '.') : trimmed;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Parse an optional non-negative decimal typed with a comma or a dot, for a
 * column that stores `maxFractionDigits` fractional digits. Empty input is
 * `null`; anything else that is not such a number, including more fractional
 * digits than the column holds, is `undefined` so the field can refuse it
 * instead of the database rounding it silently.
 */
export function parseBoundedDecimalInput(
  value: string,
  maxFractionDigits: number,
): number | null | undefined {
  const trimmed = value.trim().replace(',', '.');
  if (trimmed.length === 0) return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) return undefined;
  const fraction = match[2] ?? '';
  return fraction.length <= maxFractionDigits ? Number(trimmed) : undefined;
}

/** Format for display in a de-DE input: integers bare, decimals with comma. */
export function formatDecimalDe(value: number, maxFractionDigits = 2): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toLocaleString('de-DE', {
        maximumFractionDigits: maxFractionDigits,
        useGrouping: false,
      });
}
