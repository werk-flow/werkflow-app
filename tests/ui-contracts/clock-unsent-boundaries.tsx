import type { ComponentProps } from 'react';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { CLOCK_ORGANIZATION_ID } from './clock-state-fixture';

// The correction form stays outside the clock's contract. The unsent section
// opens it with the kept events' day and times, and lets the events go only
// after the form reported the filed request.

type ManualEntryDialogProps = ComponentProps<
  typeof import('@/components/manual-entry-dialog').ManualEntryDialog
>;

/** A colleague an Admin or Büro person may file the request for instead. */
const COLLEAGUE_ID = '10000000-0000-4000-8000-0000000000cc';

/** The entries the server answers for a filed request: a clock-in at noon of the chosen day. */
function filedEntries(userId: string, day: Date | undefined): TimeEntry[] {
  const timestamp = new Date(day ?? Date.now());
  timestamp.setHours(12, 0, 0, 0);
  const at = timestamp.toISOString();
  return [
    {
      id: '60000000-0000-4000-8000-000000000001',
      userId,
      organizationId: CLOCK_ORGANIZATION_ID,
      entryType: 'clock_in',
      timestamp: at,
      isManual: true,
      jobId: null,
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      createdAt: at,
      updatedAt: at,
    },
  ];
}

export function ManualEntryDialog({
  controlledOpen,
  onOpenChange,
  onSuccess,
  preselectedUserId,
  preselectedDate,
  preselectedClockInTime,
  preselectedClockOutTime,
}: ManualEntryDialogProps) {
  if (!controlledOpen) return null;
  return (
    <div role="dialog" aria-label="Zeit nachtragen">
      <output aria-label="Vorbelegung">
        {[
          preselectedDate ? preselectedDate.toLocaleDateString('de-DE') : 'kein Tag',
          preselectedClockInTime ?? 'kein Beginn',
          preselectedClockOutTime ?? 'kein Ende',
        ].join(' | ')}
      </output>
      <button
        type="button"
        onClick={() =>
          void Promise.resolve(
            onSuccess?.(filedEntries(preselectedUserId ?? COLLEAGUE_ID, preselectedDate)),
          ).then(() => onOpenChange?.(false))
        }
      >
        Korrektur einreichen
      </button>
      <button
        type="button"
        onClick={() =>
          void Promise.resolve(onSuccess?.(filedEntries(COLLEAGUE_ID, preselectedDate))).then(() =>
            onOpenChange?.(false),
          )
        }
      >
        Für Kollegin einreichen
      </button>
      <button type="button" onClick={() => onOpenChange?.(false)}>
        Formular schließen
      </button>
    </div>
  );
}
