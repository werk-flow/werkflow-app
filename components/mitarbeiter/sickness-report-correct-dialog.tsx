'use client';

import { Loader2 } from 'lucide-react';

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
import { Textarea } from '@/components/ui/textarea';
import { SICKNESS_TYPE_LABELS, type SicknessAbsenceType, type SicknessReport } from '@/lib/sickness/types';
import { cn, toLocalDateString } from '@/lib/utils';

import {
  useSicknessReportCorrectionForm,
  type SicknessReportCorrectionForm,
} from './use-sickness-report-correction-form';

export function CorrectSicknessDialog({
  report,
  onClose,
}: {
  report: SicknessReport;
  onClose: (saved: boolean) => void;
}) {
  const form = useSicknessReportCorrectionForm(report, onClose);
  const { absenceType, setAbsenceType, reason, setReason, isSaving, error, fieldErrors, handleSubmit } = form;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)} pending={isSaving}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Krankmeldung korrigieren</DialogTitle>
          <DialogDescription>Jede Korrektur bleibt im Verlauf nachvollziehbar.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-4">
            <Field label="Art" htmlFor="correct-sickness-type">
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

            <SicknessReportCorrectionPeriodFields form={form} />

            <Field label="Grund" htmlFor="correct-sickness-reason" required error={fieldErrors.reason}>
              <Textarea
                placeholder="z. B. Datum telefonisch korrigiert"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
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
              {isSaving ? 'Wird gespeichert…' : 'Korrektur speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SicknessReportCorrectionPeriodFields({ form }: { form: SicknessReportCorrectionForm }) {
  const {
    startDate,
    setStartDate,
    endKnown,
    setEndKnown,
    endDate,
    setEndDate,
    halfDay,
    setHalfDay,
    isSaving,
    fieldErrors,
    isSingleDay,
  } = form;

  return (
    <>
      <div className="flex items-center gap-2">
        <Checkbox
          id="correct-sickness-end-known"
          checked={endKnown}
          onCheckedChange={(checked) => setEndKnown(checked === true)}
          disabled={isSaving}
        />
        <Label htmlFor="correct-sickness-end-known" className="text-sm font-normal">
          Enddatum ist bekannt
        </Label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Ab" htmlFor="correct-sickness-start" required error={fieldErrors.start}>
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
        {endKnown && (
          <Field label="Bis" htmlFor="correct-sickness-end" required error={fieldErrors.end}>
            <DatePicker
              ariaLabel="Bis"
              value={endDate ? new Date(`${endDate}T00:00:00`) : undefined}
              onChange={(date) => setEndDate(date ? toLocalDateString(date) : '')}
              disabled={isSaving}
            />
          </Field>
        )}
      </div>

      {endKnown && (
        <div className="flex items-center gap-2">
          <Checkbox
            id="correct-sickness-half-day"
            checked={halfDay && isSingleDay}
            onCheckedChange={(checked) => setHalfDay(checked === true)}
            disabled={isSaving || !isSingleDay}
          />
          <Label
            htmlFor="correct-sickness-half-day"
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
