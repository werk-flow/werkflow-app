export function formatOpenSince(days: number): string {
  if (days <= 0) return 'heute eingegangen';
  if (days === 1) return 'offen seit 1 Tag';
  return `offen seit ${days} Tagen`;
}
