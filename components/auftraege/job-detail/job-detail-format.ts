import { formatDuration } from '@/lib/time-tracking/helpers';
import { normalizeJobPlannedTime, type JobPriority } from '@/lib/jobs/types';

export const PRIORITY_CLASSES: Record<JobPriority, string> = {
  niedrig: 'bg-secondary text-secondary-foreground',
  mittel: 'bg-info-soft text-info-soft-foreground',
  hoch: 'bg-destructive-soft text-destructive-soft-foreground',
};

export function formatPlannedTime(plannedTime: string | null): string {
  return normalizeJobPlannedTime(plannedTime) ?? '—';
}

export function formatDurationOrDash(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return '—';
  return formatDuration(minutes);
}
