import type { ComponentProps } from 'react';

// The correction form stays outside the clock's contract. The unsent section
// opens it with the kept events' day and times, and lets the events go only
// after the form reported the filed request.

type ManualEntryDialogProps = ComponentProps<
  typeof import('@/components/manual-entry-dialog').ManualEntryDialog
>;

export function ManualEntryDialog({
  controlledOpen,
  onOpenChange,
  onSuccess,
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
        onClick={() => void Promise.resolve(onSuccess?.([])).then(() => onOpenChange?.(false))}
      >
        Korrektur einreichen
      </button>
      <button type="button" onClick={() => onOpenChange?.(false)}>
        Formular schließen
      </button>
    </div>
  );
}
