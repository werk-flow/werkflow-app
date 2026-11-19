import type { ComponentProps } from 'react';

// The correction form stays outside the clock's contract. The unsent section
// opens it with the kept events' day and times, and lets the events go only
// after the form reported the filed request.

type ManualEntryDialogProps = ComponentProps<
  typeof import('@/components/manual-entry-dialog').ManualEntryDialog
>;

/** A colleague an Admin or Büro person may file the request for instead. */
const COLLEAGUE_ID = '10000000-0000-4000-8000-0000000000cc';

/** The day a filed request records, as the form reports it (`YYYY-MM-DD`). */
function filedDay(day: Date | undefined): string {
  const date = day ?? new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
            // An employee's own earlier day answers no entries until the office approves it.
            onSuccess?.([], { userId: preselectedUserId ?? COLLEAGUE_ID, day: filedDay(preselectedDate) }),
          ).then(() => onOpenChange?.(false))
        }
      >
        Korrektur einreichen
      </button>
      <button
        type="button"
        onClick={() =>
          void Promise.resolve(
            onSuccess?.([], { userId: COLLEAGUE_ID, day: filedDay(preselectedDate) }),
          ).then(() => onOpenChange?.(false))
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

// The guided correction of a late chain on a session the server holds: it reads the person's entries
// and opens the correction form for the session's end. The contract sets what the read answers.

type ClockReplacementFixture = {
  entries: import('@/lib/time-tracking/types').TimeEntry[];
  readFails: boolean;
  reads: number;
};

declare global {
  interface Window {
    clockReplacement?: ClockReplacementFixture;
  }
}

export async function getTimeEntries(): Promise<import('@/lib/time-tracking/types').GetTimeEntriesResult> {
  const fixture = window.clockReplacement ?? { entries: [], readFails: false, reads: 0 };
  fixture.reads += 1;
  return fixture.readFails
    ? { success: false, error: 'time_entries_unavailable' }
    : { success: true, entries: fixture.entries };
}

export function useClosedTimePeriods(): readonly never[] {
  return [];
}

type TimeCorrectionDialogProps = ComponentProps<
  typeof import('@/components/zeiterfassung/time-correction-dialog').TimeCorrectionDialog
>;

/** The correction form, as far as the flow uses it: the entry it edits, a filed request of a kind, a closed form. */
export function TimeCorrectionDialog({ open, onOpenChange, entry, onSubmitted }: TimeCorrectionDialogProps) {
  if (!open) return null;
  return (
    <div role="dialog" aria-label="Zeit korrigieren">
      <output aria-label="Vorbelegung">
        {[entry?.canonicalSegmentId, entry?.entryType, entry?.timestamp].join(' | ')}
      </output>
      <button
        type="button"
        onClick={() => {
          // The real form closes, then reports the filed request.
          onOpenChange?.(false);
          onSubmitted?.({ kind: 'edit' });
        }}
      >
        Korrektur einreichen
      </button>
      <button
        type="button"
        onClick={() => {
          // The person switched the form to another kind: it leaves the recorded end as it is.
          onOpenChange?.(false);
          onSubmitted?.({ kind: 'reclassify' });
        }}
      >
        Andere Korrektur einreichen
      </button>
      <button type="button" onClick={() => onOpenChange?.(false)}>
        Formular schließen
      </button>
    </div>
  );
}
