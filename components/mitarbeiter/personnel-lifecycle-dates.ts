import { getBusinessTodayIso, tomorrowMorningInBerlin } from '@/lib/date-time/berlin';
import { formatBerlin } from '@/lib/utils';

export function formatLifecycleDate(value: string | null): string {
  if (!value) return 'Nicht festgelegt';
  return formatBerlin(value, 'date');
}

export function todayDate(): Date {
  return new Date(`${getBusinessTodayIso()}T12:00:00`);
}

export function defaultAccessDateTime(): string {
  return tomorrowMorningInBerlin();
}
