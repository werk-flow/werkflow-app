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
