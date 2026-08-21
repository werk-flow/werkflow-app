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

/** Parse a comma- or dot-decimal string; returns 0 for unparseable input. */
export function parseDecimalInput(value: string): number {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
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
