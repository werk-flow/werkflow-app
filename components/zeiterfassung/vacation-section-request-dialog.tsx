'use client';

import { useState } from 'react';

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
import { Textarea } from '@/components/ui/textarea';
import { useServerAction } from '@/hooks/use-server-action';
import { createVacationRequest } from '@/lib/vacation/actions';
import { formatVacationDays } from '@/lib/vacation/balance';
import { cn, toLocalDateString } from '@/lib/utils';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import { describeFailure } from '@/lib/action-messages';
import { useVacationDaysPreview } from './use-vacation-section-days-preview';
import { getVacationRequestErrorMessage, REQUEST_ERROR_MESSAGES } from './vacation-section-messages';
import { Spinner } from '@/components/ui/spinner';

const PREVIEW_ERROR_MESSAGES = {
  no_employee_record: REQUEST_ERROR_MESSAGES.no_employee_record,
  not_authenticated: REQUEST_ERROR_MESSAGES.not_authenticated,
  not_a_member: REQUEST_ERROR_MESSAGES.not_a_member,
  load_failed: 'Die Urlaubstage konnten nicht berechnet werden.',
  unexpected_error: 'Die Urlaubstage konnten nicht berechnet werden.',
} satisfies Record<string, string>;

type VacationRequestDateErrors = {
  start?: string | undefined;
  end?: string | undefined;
};

type VacationRequestPeriodFieldsProps = {
  startDate: string;
  setStartDate: (value: string) => void;
  endDate: string;
  setEndDate: (value: string) => void;
  halfDay: boolean;
  setHalfDay: (value: boolean) => void;
  isSingleDay: boolean;
  invalidatePreview: () => void;
  isSaving: boolean;
  dateErrors: VacationRequestDateErrors;
  rangePreviewError: string | null;
};

function VacationRequestPeriodFields({
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  halfDay,
  setHalfDay,
  isSingleDay,
  invalidatePreview,
  isSaving,
  dateErrors,
  rangePreviewError,
}: VacationRequestPeriodFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Von" htmlFor="vacation-start-date" required error={dateErrors.start}>
          <DatePicker
            ariaLabel="Von"
            value={startDate ? new Date(`${startDate}T00:00:00`) : undefined}
            onChange={(date) => {
              const next = date ? toLocalDateString(date) : '';
              const nextEnd = next && (!endDate || endDate < next) ? next : endDate;
              if (next === startDate && nextEnd === endDate) return;
              invalidatePreview();
              setStartDate(next);
              if (nextEnd !== endDate) setEndDate(nextEnd);
            }}
            disabled={isSaving}
          />
        </Field>
        <Field label="Bis" htmlFor="vacation-end-date" required error={dateErrors.end ?? rangePreviewError}>
          <DatePicker
            ariaLabel="Bis"
            value={endDate ? new Date(`${endDate}T00:00:00`) : undefined}
            onChange={(date) => {
              const next = date ? toLocalDateString(date) : '';
              if (next === endDate) return;
              invalidatePreview();
              setEndDate(next);
            }}
            disabled={isSaving}
          />
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="vacation-half-day"
          checked={halfDay && isSingleDay}
          onCheckedChange={(checked) => {
            invalidatePreview();
            setHalfDay(checked === true);
          }}
          disabled={isSaving || !isSingleDay}
        />
        <Label
          htmlFor="vacation-half-day"
          className={cn('text-sm font-normal', !isSingleDay && 'text-muted-foreground')}
        >
          Halbtägig (0,5 Tage)
          {!isSingleDay && ' – nur bei einem einzelnen Tag'}
        </Label>
      </div>
    </>
  );
}

type VacationDaysPreviewStatusProps = {
  isPreviewing: boolean;
  previewDays: number | null;
  previewError: string | null;
  rangePreviewError: string | null;
  retryPreview: () => void;
};

function VacationDaysPreviewStatus({
  isPreviewing,
  previewDays,
  previewError,
  rangePreviewError,
  retryPreview,
}: VacationDaysPreviewStatusProps) {
  return (
    <div aria-live="polite" className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
      {isPreviewing ? (
        <span className="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          Urlaubstage werden berechnet…
        </span>
      ) : previewDays !== null ? (
        <span data-testid="vacation-days-preview">
          Berechnete Urlaubstage: <strong>{formatVacationDays(previewDays)}</strong>
        </span>
      ) : rangePreviewError ? null : previewError ? (
        <span className="flex items-center justify-between gap-3 text-destructive">
          {describeFailure(
            previewError,
            PREVIEW_ERROR_MESSAGES,
            'Die Urlaubstage konnten nicht berechnet werden.',
          )}
          {(previewError === 'load_failed' || previewError === 'unexpected_error') && (
            <Button type="button" variant="outline" size="sm" onClick={retryPreview}>
              Erneut berechnen
            </Button>
          )}
        </span>
      ) : null}
    </div>
  );
}

export function OwnVacationRequestDialog({
  hasEntitlement,
  onClose,
}: {
  hasEntitlement: boolean;
  onClose: (saved: boolean) => void;
}) {
  const todayIso = getBusinessTodayIso();
  const [startDate, setStartDate] = useState<string>(todayIso);
  const [endDate, setEndDate] = useState<string>(todayIso);
  const [halfDay, setHalfDay] = useState(false);
  const [comment, setComment] = useState('');
  const { run: runSave, isPending: isSaving } = useServerAction(createVacationRequest);
  const [error, setError] = useState<string | null>(null);
  const [dateErrors, setDateErrors] = useState<VacationRequestDateErrors>({});

  const isSingleDay = startDate === endDate;
  const dayPortion = halfDay && isSingleDay ? 'half_day' : 'full';
  const rangePreviewError =
    startDate && endDate && endDate < startDate ? REQUEST_ERROR_MESSAGES.invalid_range : null;

  const { previewDays, isPreviewing, previewError, invalidatePreview, retryPreview } = useVacationDaysPreview(
    { startDate, endDate, dayPortion },
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);

    const nextDateErrors = {
      start: startDate ? undefined : 'Bitte wähle ein Startdatum aus.',
      end: !endDate
        ? 'Bitte wähle ein Enddatum aus.'
        : endDate < startDate
          ? REQUEST_ERROR_MESSAGES.invalid_range
          : undefined,
    };
    setDateErrors(nextDateErrors);
    if (nextDateErrors.start || nextDateErrors.end) {
      document.getElementById(nextDateErrors.start ? 'vacation-start-date' : 'vacation-end-date')?.focus();
      return;
    }

    const saveFailedMessage = 'Der Antrag konnte nicht gespeichert werden.';
    try {
      const result = await runSave({
        startDate,
        endDate,
        dayPortion,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      if (result.success) {
        onClose(true);
      } else {
        setError(getVacationRequestErrorMessage(result.error, saveFailedMessage));
      }
    } catch {
      setError(saveFailedMessage);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)} pending={isSaving}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Urlaub beantragen</DialogTitle>
          <DialogDescription>
            Der Antrag wird zur Freigabe eingereicht. Wochenenden, Feiertage, Betriebsruhe und freie Tage laut
            Arbeitszeitmodell kosten keine Urlaubstage.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <VacationRequestPeriodFields
              startDate={startDate}
              setStartDate={setStartDate}
              endDate={endDate}
              setEndDate={setEndDate}
              halfDay={halfDay}
              setHalfDay={setHalfDay}
              isSingleDay={isSingleDay}
              invalidatePreview={invalidatePreview}
              isSaving={isSaving}
              dateErrors={dateErrors}
              rangePreviewError={rangePreviewError}
            />

            <VacationDaysPreviewStatus
              isPreviewing={isPreviewing}
              previewDays={previewDays}
              previewError={previewError}
              rangePreviewError={rangePreviewError}
              retryPreview={retryPreview}
            />

            <Field label="Notiz (optional)" htmlFor="vacation-comment">
              <Textarea
                placeholder="z. B. Familienfeier"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={isSaving}
              />
            </Field>

            {!hasEntitlement && (
              <p className="text-xs text-muted-foreground">
                Hinweis: Für dich ist noch kein Urlaubsanspruch hinterlegt. Der Antrag ist trotzdem möglich;
                die Freigabe entscheidet dein Betrieb.
              </p>
            )}

            <ErrorText>{error}</ErrorText>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onClose(false)} disabled={isSaving}>
              Abbrechen
            </Button>
            <Button pending={isSaving} type="submit" disabled={isSaving || isPreviewing}>
              {isSaving ? 'Wird eingereicht…' : 'Antrag einreichen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
