'use client';

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
import { SICKNESS_TYPE_LABELS, type SicknessAbsenceType } from '@/lib/sickness/types';
import { cn, toLocalDateString } from '@/lib/utils';

import {
  useSicknessReportRecordForm,
  type SicknessReportRecordForm,
} from './use-sickness-report-record-form';

export function RecordSicknessDialog({
  recordId,
  onClose,
}: {
  recordId: string;
  onClose: (saved: boolean) => void;
}) {
  const form = useSicknessReportRecordForm(recordId, onClose);
  const {
    absenceType,
    setAbsenceType,
    evidenceRequired,
    setEvidenceRequired,
    isSaving,
    error,
    overlapHint,
    handleSubmit,
  } = form;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(overlapHint)} pending={isSaving}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Krankmeldung erfassen</DialogTitle>
          <DialogDescription>
            Für telefonische oder persönliche Meldungen. Es werden keine Krankheitsdetails erfasst.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-4">
            <Field label="Art" htmlFor="record-sickness-type">
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

            <SicknessReportRecordPeriodFields form={form} />

            <div className="flex items-center gap-2">
              <Checkbox
                id="record-sickness-evidence"
                checked={evidenceRequired}
                onCheckedChange={(checked) => setEvidenceRequired(checked === true)}
                disabled={isSaving}
              />
              <Label htmlFor="record-sickness-evidence" className="text-sm font-normal">
                Nachweis erforderlich (Entscheidung des Betriebs)
              </Label>
            </div>

            {overlapHint && (
              <p role="status" className="text-xs text-muted-foreground">
                Hinweis: Der Zeitraum überschneidet sich mit genehmigtem Urlaub. Eine Anpassung des Urlaubs
                bleibt eine bewusste Entscheidung über die Urlaubsverwaltung.
              </p>
            )}

            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            {overlapHint ? (
              <Button type="button" onClick={() => onClose(true)}>
                Verstanden
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => onClose(false)} disabled={isSaving}>
                  Abbrechen
                </Button>
                <Button pending={isSaving} type="submit" disabled={isSaving}>
                  {isSaving ? 'Wird gespeichert…' : 'Krankmeldung erfassen'}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SicknessReportRecordPeriodFields({ form }: { form: SicknessReportRecordForm }) {
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
    dateErrors,
    isSingleDay,
  } = form;

  return (
    <>
      <Field label="Ab" htmlFor="record-sickness-start" required error={dateErrors.start}>
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
          id="record-sickness-end-known"
          checked={endKnown}
          onCheckedChange={(checked) => setEndKnown(checked === true)}
          disabled={isSaving}
        />
        <Label htmlFor="record-sickness-end-known" className="text-sm font-normal">
          Enddatum ist schon bekannt
        </Label>
      </div>

      {endKnown ? (
        <Field label="Bis" htmlFor="record-sickness-end" required error={dateErrors.end}>
          <DatePicker
            ariaLabel="Bis"
            value={endDate ? new Date(`${endDate}T00:00:00`) : undefined}
            onChange={(date) => setEndDate(date ? toLocalDateString(date) : '')}
            disabled={isSaving}
          />
        </Field>
      ) : (
        <p className="text-xs text-muted-foreground">Ohne Enddatum gilt die Meldung bis auf Weiteres.</p>
      )}

      {endKnown && (
        <div className="flex items-center gap-2">
          <Checkbox
            id="record-sickness-half-day"
            checked={halfDay && isSingleDay}
            onCheckedChange={(checked) => setHalfDay(checked === true)}
            disabled={isSaving || !isSingleDay}
          />
          <Label
            htmlFor="record-sickness-half-day"
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
