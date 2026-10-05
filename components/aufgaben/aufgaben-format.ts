import { formatGermanDate } from '@/lib/utils';

export function formatRange(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatGermanDate(startDate);
  return `${formatGermanDate(startDate)} – ${formatGermanDate(endDate)}`;
}

export function formatOpenSince(days: number): string {
  if (days <= 0) return 'heute eingegangen';
  if (days === 1) return 'offen seit 1 Tag';
  return `offen seit ${days} Tagen`;
}

// P1-08: sickness ranges are honest about open ends („bis auf Weiteres").
export function formatSicknessRange(startDate: string, endDate: string | null): string {
  if (endDate === null) return `${formatGermanDate(startDate)} – bis auf Weiteres`;
  return formatRange(startDate, endDate);
}
