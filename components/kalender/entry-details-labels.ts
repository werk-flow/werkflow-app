// German labels and formatters of the calendar entry details dialog.

import { calendarRefusalMessage } from '@/lib/calendar/messages';
import { formatDuration } from '@/lib/time-tracking/helpers';
import type { TimeEntry, WorkSession } from '@/lib/time-tracking/types';

export type StatusConfig = { label: string; className: string };

const STATUS_LABELS = {
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
  draft: {
    label: 'Neu',
    className: 'bg-info-soft text-info-soft-foreground',
  },
} satisfies Record<string, StatusConfig>;
const STATUS_LABEL_BY_CODE: Record<string, StatusConfig> = STATUS_LABELS;

export function formatDateTime(date: Date): string {
  return date.toLocaleString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatActionError(error: string): string {
  if (error === 'validation_failed') {
    return 'Diese Zeitänderung würde zu einer ungültigen oder überlappenden Arbeitszeit führen.';
  }

  if (error === 'job_not_found') {
    return 'Der Auftrag wurde nicht gefunden.';
  }

  return calendarRefusalMessage(error) ?? 'Die Änderung konnte nicht gespeichert werden.';
}

export function getStatusConfig(entry?: TimeEntry | null): StatusConfig {
  if (!entry) return STATUS_LABELS.draft;
  return STATUS_LABEL_BY_CODE[entry.status] ?? STATUS_LABELS.approved;
}

export function getEntryLabel(entry: TimeEntry, index = 0): string {
  switch (entry.entryType) {
    case 'clock_in':
      return 'Arbeitsbeginn';
    case 'clock_out':
      return 'Arbeitsende';
    case 'break_start':
      return index > 0 ? `Pausenbeginn ${index + 1}` : 'Pausenbeginn';
    case 'break_end':
      return index > 0 ? `Pausenende ${index + 1}` : 'Pausenende';
    default:
      return 'Eintrag';
  }
}

export function getEntryDetailsDescription(session: WorkSession, isOrphan: boolean): string {
  if (isOrphan) {
    if (session.clockIn && !session.clockOut) {
      return 'Einzelner Einstempel-Eintrag (unvollständig)';
    }

    return 'Einzelner Ausstempel-Eintrag (unvollständig)';
  }

  if (session.durationMinutes) {
    return `Arbeitszeit: ${formatDuration(session.durationMinutes)}`;
  }

  return 'Aktive Sitzung';
}
