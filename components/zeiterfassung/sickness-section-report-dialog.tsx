'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
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
import { reportOwnSickness } from '@/lib/sickness/actions';
import {
  SICKNESS_ERROR_MESSAGES,
  SICKNESS_TYPE_LABELS,
  type SicknessAbsenceType,
} from '@/lib/sickness/types';
import { cn, toLocalDateString } from '@/lib/utils';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import { describeFailure } from '@/lib/action-messages';

type OwnSicknessReportDateErrors = {
  start?: string | undefined;
  end?: string | undefined;
};

type OwnSicknessReportFieldsProps = {
  absenceType: SicknessAbsenceType;
  setAbsenceType: (value: SicknessAbsenceType) => void;
  startDate: string;
  setStartDate: (value: string) => void;
  endKnown: boolean;
  setEndKnown: (value: boolean) => void;
  endDate: string;
  setEndDate: (value: string) => void;
  halfDay: boolean;
  setHalfDay: (value: boolean) => void;
  isSingleDay: boolean;
  isSaving: boolean;
  dateErrors: OwnSicknessReportDateErrors;
};

function OwnSicknessReportFields({
  absenceType,
  setAbsenceType,
  startDate,
  setStartDate,
  endKnown,
  setEndKnown,
  endDate,
  setEndDate,
  halfDay,
  setHalfDay,
  isSingleDay,
  isSaving,
  dateErrors,
}: OwnSicknessReportFieldsProps) {
  return (
    <>
      <Field label="Art" htmlFor="sickness-type">
        <Select
          value={absenceType}
          onValueChange={(value) => setAbsenceType(value as SicknessAbsenceType)}
          disabled={isSaving}
        >
          <SelectTrigger aria-label="Art">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SICKNESS_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Ab" htmlFor="sickness-start-date" required error={dateErrors.start}>
        <DatePicker
          ariaLabel="Ab"
          value={startDate ? new Date(`${startDate}T00:00:00`) : undefined}
          onChange={(date) => {
            const next = date ? toLocalDateString(date) : '';
            setStartDate(next);
            if (next && endKnown && (!endDate || endDate < next)) {
              setEndDate(next);
            }
          }}
          disabled={isSaving}
        />
      </Field>

      <div className="flex items-center gap-2">
        <Checkbox
          id="sickness-end-known"
          checked={endKnown}
          onCheckedChange={(checked) => setEndKnown(checked === true)}
          disabled={isSaving}
        />
        <Label htmlFor="sickness-end-known" className="text-sm font-normal">
          Enddatum ist schon bekannt
        </Label>
      </div>

      {endKnown ? (
        <Field label="Bis" htmlFor="sickness-end-date" required error={dateErrors.end}>
          <DatePicker
            ariaLabel="Bis"
            value={endDate ? new Date(`${endDate}T00:00:00`) : undefined}
            onChange={(date) => setEndDate(date ? toLocalDateString(date) : '')}
            disabled={isSaving}
          />
        </Field>
      ) : (
        <p className="text-xs text-muted-foreground">
          Ohne Enddatum gilt die Meldung bis auf Weiteres. Du kannst das Enddatum später nachtragen.
        </p>
      )}

      {endKnown && (
        <div className="flex items-center gap-2">
          <Checkbox
            id="sickness-half-day"
            checked={halfDay && isSingleDay}
            onCheckedChange={(checked) => setHalfDay(checked === true)}
            disabled={isSaving || !isSingleDay}
          />
          <Label
            htmlFor="sickness-half-day"
            className={cn('text-sm font-normal', !isSingleDay && 'text-muted-foreground')}
          >
            Halbtägig
            {!isSingleDay && ' – nur bei einem einzelnen Tag'}
          </Label>
        </div>
      )}
    </>
  );
}

export function OwnSicknessReportDialog({ onClose }: { onClose: (saved: boolean) => void }) {
  const todayIso = getBusinessTodayIso();
  const [absenceType, setAbsenceType] = useState<SicknessAbsenceType>('krankheit');
  const [startDate, setStartDate] = useState<string>(todayIso);
  const [endKnown, setEndKnown] = useState(false);
  const [endDate, setEndDate] = useState<string>(todayIso);
  const [halfDay, setHalfDay] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlapHint, setOverlapHint] = useState(false);
  const [dateErrors, setDateErrors] = useState<OwnSicknessReportDateErrors>({});

  const isSingleDay = endKnown && startDate === endDate;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);

    const nextDateErrors = {
      start: startDate ? undefined : 'Bitte wähle ein Datum aus.',
      end:
        endKnown && !endDate
          ? 'Bitte wähle ein Datum aus.'
          : endKnown && endDate < startDate
            ? SICKNESS_ERROR_MESSAGES.invalid_range
            : undefined,
    };
    setDateErrors(nextDateErrors);
    if (nextDateErrors.start || nextDateErrors.end) {
      document.getElementById(nextDateErrors.start ? 'sickness-start-date' : 'sickness-end-date')?.focus();
      return;
    }

    setIsSaving(true);
    try {
      const result = await reportOwnSickness({
        absenceType,
        startDate,
        endDate: endKnown ? endDate : null,
        dayPortion: halfDay && isSingleDay ? 'half_day' : 'full',
      });
      if (result.success) {
        if (result.vacationOverlap) {
          // Informational only: the office decides any vacation consequence.
          // The dialog stays open until the person confirms the hint.
          setOverlapHint(true);
        } else {
          onClose(true);
        }
      } else {
        setError(
          describeFailure(
            result.error,
            SICKNESS_ERROR_MESSAGES,
            'Die Meldung konnte nicht gespeichert werden.',
          ),
        );
      }
    } catch {
      setError('Die Meldung konnte nicht gespeichert werden.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(overlapHint)} pending={isSaving}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Krank melden</DialogTitle>
          <DialogDescription>
            Dein Betrieb wird informiert. Es werden keine Krankheitsdetails abgefragt – bitte gib keine
            Diagnose an.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <OwnSicknessReportFields
              absenceType={absenceType}
              setAbsenceType={setAbsenceType}
              startDate={startDate}
              setStartDate={setStartDate}
              endKnown={endKnown}
              setEndKnown={setEndKnown}
              endDate={endDate}
              setEndDate={setEndDate}
              halfDay={halfDay}
              setHalfDay={setHalfDay}
              isSingleDay={isSingleDay}
              isSaving={isSaving}
              dateErrors={dateErrors}
            />

            {overlapHint && (
              <p role="status" className="text-xs text-muted-foreground">
                Hinweis: Der Zeitraum überschneidet sich mit genehmigtem Urlaub. Dein Büro entscheidet, wie
                damit umgegangen wird.
              </p>
            )}

            <ErrorText>{error}</ErrorText>
          </div>
          <DialogFooter>
            {overlapHint ? (
              // The report is saved; the hint must be acknowledged, not raced
              // by an auto-close timer.
              <Button type="button" onClick={() => onClose(true)}>
                Verstanden
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => onClose(false)} disabled={isSaving}>
                  Abbrechen
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving && <Loader2 className="size-4 animate-spin" />}
                  {isSaving ? 'Wird gemeldet…' : 'Krank melden'}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
