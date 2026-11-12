'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { logError } from '@/lib/logging';
import { endSchoolDay } from '@/lib/personnel/school-day-actions';
import {
  describeSchoolDay,
  SCHOOL_DAY_ERROR_MESSAGES,
  SCHOOL_WEEKDAYS,
  type SchoolDay,
} from '@/lib/personnel/school-days';
import { WEEKDAY_LABELS } from '@/lib/personnel/schedule';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { toLocalDateString } from '@/lib/utils';

import {
  SCHOOL_DAY_KIND_LABELS,
  useAddSchoolDayForm,
  type AddSchoolDayForm,
  type SchoolDayFormKind,
} from './use-add-school-day-form';

function isKind(value: string): value is SchoolDayFormKind {
  return Object.hasOwn(SCHOOL_DAY_KIND_LABELS, value);
}

function SchoolDateField({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  disabled: boolean;
}) {
  return (
    <Field label={label} htmlFor={id} required error={error}>
      <DatePicker
        ariaLabel={label}
        value={value ? new Date(`${value}T00:00:00`) : undefined}
        onChange={(date) => onChange(date ? toLocalDateString(date) : '')}
        disabled={disabled}
      />
    </Field>
  );
}

function DialogActions({
  isPending,
  label,
  onCancel,
}: {
  isPending: boolean;
  label: string;
  onCancel: () => void;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
        Abbrechen
      </Button>
      <Button pending={isPending} type="submit" disabled={isPending}>
        {isPending ? 'Wird gespeichert…' : label}
      </Button>
    </DialogFooter>
  );
}

/** Records a weekly school day or a block for one apprentice. */
export function AddSchoolDayDialog({
  recordId,
  onClose,
}: {
  recordId: string;
  onClose: (saved: boolean) => void;
}) {
  const form = useAddSchoolDayForm(recordId, onClose);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)} pending={form.isPending}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Berufsschule erfassen</DialogTitle>
          <DialogDescription>
            An diesen Tagen gilt das normale Tagesziel als erfüllt. Abgeschlossene Monate bleiben unverändert.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-4">
            <SchoolDayKindFields form={form} />
            <SchoolDayPeriodFields form={form} />
            <ErrorText>{form.error}</ErrorText>
          </DialogBody>
          <DialogActions
            isPending={form.isPending}
            label="Berufsschule speichern"
            onCancel={() => onClose(false)}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SchoolDayKindFields({ form }: { form: AddSchoolDayForm }) {
  const { kind, setKind, weekday, setWeekday, isPending } = form;
  return (
    <>
      <Field label="Art" htmlFor="school-day-kind">
        <Select
          value={kind}
          onValueChange={(next) => {
            if (isKind(next)) setKind(next);
          }}
          disabled={isPending}
        >
          <SelectTrigger id="school-day-kind" aria-label="Art">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SCHOOL_DAY_KIND_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {kind === 'weekday' && (
        <Field label="Wochentag" htmlFor="school-day-weekday">
          <Select
            value={String(weekday)}
            onValueChange={(next) => setWeekday(Number(next))}
            disabled={isPending}
          >
            <SelectTrigger id="school-day-weekday" aria-label="Wochentag">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCHOOL_WEEKDAYS.map((day) => (
                <SelectItem key={day} value={String(day)}>
                  {WEEKDAY_LABELS[day]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    </>
  );
}

function SchoolDayPeriodFields({ form }: { form: AddSchoolDayForm }) {
  const { kind, startDate, setStartDate, endKnown, setEndKnown, endDate, setEndDate, needsEnd } = form;
  const { fieldErrors, isPending } = form;
  return (
    <>
      <SchoolDateField
        id="school-day-start"
        label={kind === 'block' ? 'Erster Schultag' : 'Ab'}
        value={startDate}
        onChange={setStartDate}
        error={fieldErrors.start}
        disabled={isPending}
      />
      {kind === 'weekday' && (
        <div className="flex items-center gap-2">
          <Checkbox
            id="school-day-end-known"
            checked={endKnown}
            onCheckedChange={(checked) => setEndKnown(checked === true)}
            disabled={isPending}
          />
          <Label htmlFor="school-day-end-known" className="text-sm font-normal">
            Enddatum ist schon bekannt
          </Label>
        </div>
      )}
      {needsEnd ? (
        <SchoolDateField
          id="school-day-end"
          label={kind === 'block' ? 'Letzter Schultag' : 'Bis'}
          value={endDate}
          onChange={setEndDate}
          error={fieldErrors.end}
          disabled={isPending}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Ohne Enddatum gilt der Schultag jede Woche bis auf Weiteres.
        </p>
      )}
    </>
  );
}

/** Ends a weekly school day on its last day, e.g. after a change of class. */
export function EndSchoolDayDialog({
  schoolDay,
  onClose,
}: {
  schoolDay: SchoolDay;
  onClose: (saved: boolean) => void;
}) {
  const { showBanner } = useBanner();
  const todayIso = getBusinessTodayIso();
  const [endDate, setEndDate] = useState(todayIso > schoolDay.startDate ? todayIso : schoolDay.startDate);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = useServerAction(endSchoolDay);
  const endError = endDate ? undefined : 'Bitte wähle ein Datum aus.';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isPending) return;
    setError(null);
    setAttempted(true);
    if (focusFirstInvalidField({ 'school-day-last': endError })) return;
    try {
      const result = await run({ schoolDayId: schoolDay.id, endDate });
      if (!result.success) {
        setError(
          describeFailure(
            result.error,
            SCHOOL_DAY_ERROR_MESSAGES,
            'Das Enddatum konnte nicht gespeichert werden.',
          ),
        );
        return;
      }
      showBanner({ variant: 'success', message: 'Das Enddatum wurde gespeichert.' });
      onClose(true);
    } catch (submitError) {
      logError('EndSchoolDayDialog: save failed', submitError);
      setError('Das Enddatum konnte nicht gespeichert werden.');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)} pending={isPending}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Enddatum setzen</DialogTitle>
          <DialogDescription>{describeSchoolDay(schoolDay)}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-4">
            <SchoolDateField
              id="school-day-last"
              label="Letzter Tag der Regel"
              value={endDate}
              onChange={setEndDate}
              error={attempted ? endError : undefined}
              disabled={isPending}
            />
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogActions isPending={isPending} label="Enddatum speichern" onCancel={() => onClose(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
