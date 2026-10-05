'use client';

import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { WEEKDAY_LABELS, type WorkSchedule } from '@/lib/personnel/schedule';
import { formatDuration } from '@/lib/time-tracking/helpers';
import { toLocalDateString } from '@/lib/utils';
import { useWorkScheduleForm } from './use-work-schedule-form';

type WorkScheduleDialogProps = {
  recordId: string;
  schedule: WorkSchedule | null;
  onClose: (saved: boolean) => void;
};

export function WorkScheduleDialog({ recordId, schedule, onClose }: WorkScheduleDialogProps) {
  const {
    validFrom,
    setValidFrom,
    dayHours,
    setDayHours,
    note,
    setNote,
    isSaving,
    error,
    validFromError,
    setValidFromError,
    weeklyMinutes,
    handleSubmit,
  } = useWorkScheduleForm({ recordId, schedule, onClose });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)} pending={isSaving}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{schedule ? 'Wochenplan bearbeiten' : 'Wochenplan hinzufügen'}</DialogTitle>
          <DialogDescription>
            Wochenpläne gelten ab ihrem Datum. Frühere Zeiträume behalten die damals gültige Version.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-4">
            <Field label="Gültig ab" htmlFor="schedule-valid-from" required error={validFromError}>
              <DatePicker
                ariaLabel="Gültig ab"
                value={validFrom ? new Date(`${validFrom}T00:00:00`) : undefined}
                onChange={(date) => {
                  setValidFromError(null);
                  setValidFrom(date ? toLocalDateString(date) : '');
                }}
                disabled={isSaving}
              />
            </Field>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">Arbeitsstunden pro Wochentag</legend>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
                {WEEKDAY_LABELS.map((label, index) => (
                  <Field
                    key={label}
                    label={<span className="text-xs font-normal text-muted-foreground">{label}</span>}
                    htmlFor={`schedule-day-${index}`}
                    className="gap-1"
                  >
                    <Input
                      inputMode="decimal"
                      value={dayHours[index]}
                      onChange={(e) => {
                        const next = [...dayHours];
                        next[index] = e.target.value;
                        setDayHours(next);
                      }}
                      disabled={isSaving}
                    />
                  </Field>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                0 bedeutet: kein Arbeitstag.
                {weeklyMinutes !== null && ` Summe: ${formatDuration(weeklyMinutes)} pro Woche.`}
              </p>
            </fieldset>
            <Field label="Notiz" htmlFor="schedule-note">
              <Input
                placeholder="z. B. Elternzeit-Teilzeit"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={isSaving}
              />
            </Field>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onClose(false)} disabled={isSaving}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              {isSaving ? 'Wird gespeichert…' : 'Speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
