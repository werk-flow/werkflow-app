/** Explicit punctuation keeps Node and browser ICU versions from changing SSR text. */
export function formatCompactCalendarRange(start: Date, end: Date): string {
  const startYear = start.getFullYear() === end.getFullYear() ? '' : String(start.getFullYear()).slice(-2);
  return `${start.getDate()}.${start.getMonth() + 1}.${startYear} – ${end.getDate()}.${end.getMonth() + 1}.${String(end.getFullYear()).slice(-2)}`;
}
