const recordNumberCollator = new Intl.Collator('de', { numeric: true });

/**
 * Orders generated record numbers such as `ANL-2026-1000` naturally: digit
 * runs compare by value, so the year decides first and `-1000` follows
 * `-101`. A missing number sorts first. The paged SQL readers apply the same
 * order on the server.
 */
export function compareRecordNumbers(left: string | null, right: string | null): number {
  return recordNumberCollator.compare(left ?? '', right ?? '');
}
