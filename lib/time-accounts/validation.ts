export function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function isValidOptionalIsoDateRange(
  validFrom: string,
  validUntil: string,
): boolean {
  return (
    isIsoCalendarDate(validFrom) &&
    (!validUntil ||
      (isIsoCalendarDate(validUntil) && validUntil >= validFrom))
  );
}
