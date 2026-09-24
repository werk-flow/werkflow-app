'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { TimeInput } from '@/components/ui/time-input';
import type { CalendarBoardRow } from '@/lib/calendar/board';
import type { CalendarJob } from '@/lib/jobs/types';
import { toLocalDateString } from '@/lib/utils';

interface ScheduleParkedDialogProps {
  job: CalendarJob;
  rows: readonly CalendarBoardRow[];
  onClose: () => void;
  onSchedule: (input: { date: string; time: string | undefined; row: CalendarBoardRow | null }) => void;
}

/** „Einplanen am …": the keyboard route from the Parkplatz onto the calendar (P1-24a, criterion 24). */
export function ScheduleParkedDialog({ job, rows, onClose, onSchedule }: ScheduleParkedDialogProps) {
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState('');
  const [recordId, setRecordId] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!date) { setError('Bitte wähle ein Datum.'); return; }
            onSchedule({ date: toLocalDateString(date), time: time || undefined, row: rows.find((row) => row.employeeRecordId === recordId) ?? null });
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Auftrag einplanen</DialogTitle>
            <DialogDescription>{job.title} verlässt den Parkplatz und landet am gewählten Tag.</DialogDescription>
          </DialogHeader>
          <Field label="Datum" htmlFor="schedule-parked-date" required error={error ?? undefined}>
            <DatePicker id="schedule-parked-date" value={date} onChange={(next) => { setDate(next); setError(null); }} ariaLabel="Datum" />
          </Field>
          <Field label="Uhrzeit" htmlFor="schedule-parked-time" description="Leer lassen für einen ganztägigen Termin.">
            <TimeInput id="schedule-parked-time" value={time} onChange={setTime} />
          </Field>
          {rows.length > 0 && (
            <Field label="Mitarbeiter" htmlFor="schedule-parked-person">
              <SearchableSelect
                id="schedule-parked-person"
                value={recordId}
                onChange={setRecordId}
                options={rows.map((row) => ({ value: row.employeeRecordId, label: row.displayName }))}
                placeholder="Bisherige Zuweisung behalten"
                allowNone
                noneLabel="Bisherige Zuweisung behalten"
                ariaLabel="Mitarbeiter"
                searchPlaceholder="Mitarbeiter suchen …"
                emptyMessage="Keine Mitarbeiter gefunden"
              />
            </Field>
          )}
          {error && !date && <ErrorText>{error}</ErrorText>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Abbrechen</Button>
            <Button type="submit">Einplanen</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
