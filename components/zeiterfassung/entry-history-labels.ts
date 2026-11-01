import type { TimeEntry, TimeEntryStatus } from '@/lib/time-tracking/types';
import { ENTRY_TYPE_LABELS } from './own-entry-changes';

// The labels of the Verlauf's entry rows (entry-history.tsx).

export const STATUS_LABELS: Record<TimeEntryStatus, { label: string; className: string }> = {
  approved: {
    label: 'Genehmigt',
    className: 'bg-success-soft text-success-soft-foreground',
  },
  pending: {
    label: 'Ausstehend',
    className: 'bg-warning-soft text-warning-soft-foreground',
  },
  rejected: {
    label: 'Abgelehnt',
    className: 'bg-destructive-soft text-destructive-soft-foreground',
  },
  pending_delete: {
    label: 'Löschung ausstehend',
    className: 'bg-warning-soft text-warning-soft-foreground',
  },
};

export function getEntryTypeLabel(entry: TimeEntry): string {
  const activityLabels = {
    work: 'Arbeit',
    travel: 'Fahrt',
    break: 'Pause',
    standby: 'Bereitschaft',
    callout: 'Notdienst',
    internal_activity: 'Interne Tätigkeit',
  } as const;
  const direction = entry.entryType === 'clock_in' || entry.entryType === 'break_start' ? 'Start' : 'Ende';
  if (entry.activityKind) return `${activityLabels[entry.activityKind]} · ${direction}`;
  return ENTRY_TYPE_LABELS[entry.entryType];
}
