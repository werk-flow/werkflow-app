'use client';

// P1-12: Parkplatz context. Deliberate parking should record WHY, WHO is
// responsible, and WHEN to review. Dismissing keeps the job parked with the
// visible "Kontext fehlt" state — nothing is fabricated. The success banner
// belongs to the calendar container (`onSaved`), which also owns the undo.

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { OptionsLoadError } from '@/components/auftraege/shared/options-load-error';
import { Button } from '@/components/ui/button';
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
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import { describeFailure, SHARED_FAILURE_MESSAGES } from '@/lib/action-messages';
import { calendarRefusalMessage } from '@/lib/calendar/messages';
import {
  getParkingResponsibleOptions,
  setJobParkingContext,
  type ParkingResponsibleOption,
} from '@/lib/parking/actions';
import {
  PARKING_ERROR_MESSAGES,
  PARKING_REASON_LABELS,
  type JobParkingContext,
  type JobParkingReason,
} from '@/lib/parking/types';
import { parseIsoLocalDate, toLocalDateString } from '@/lib/utils';
import { parkWorkTarget } from '@/lib/work-lifecycle/actions';

/** The responsible-person options, with the retry of a failed load. */
function useParkingResponsibleOptions() {
  const [options, setOptions] = useState<ParkingResponsibleOption[]>([]);
  const [optionsError, setOptionsError] = useState(false);
  const [optionsReloadCount, setOptionsReloadCount] = useState(0);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await getParkingResponsibleOptions();
        if (cancelled) return;
        if (result.success) setOptions(result.options);
        else setOptionsError(true);
      } catch {
        if (!cancelled) setOptionsError(true);
      } finally {
        if (!cancelled) setIsLoadingOptions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [optionsReloadCount]);

  function retryOptions() {
    setOptionsError(false);
    setIsLoadingOptions(true);
    setOptionsReloadCount((count) => count + 1);
  }

  return { options, optionsError, isLoadingOptions, retryOptions };
}

export function ParkingContextDialog({
  jobId,
  jobTitle,
  existingContext,
  expectedExecutionVersion,
  isAlreadyParked,
  onClose,
  onSaveStart,
  onSaveFailed,
  onSaved,
}: {
  jobId: string;
  jobTitle: string;
  existingContext: JobParkingContext | null;
  expectedExecutionVersion: number;
  isAlreadyParked: boolean;
  onClose: () => void;
  onSaveStart?: () => () => void;
  onSaveFailed?: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState<JobParkingReason>(existingContext?.reason ?? 'other');
  const [note, setNote] = useState(existingContext?.note ?? '');
  const [responsibleId, setResponsibleId] = useState<string>(
    existingContext?.responsibleEmployeeRecordId ?? '',
  );
  const [reviewDate, setReviewDate] = useState<Date | undefined>(() =>
    existingContext?.nextReviewDate ? parseIsoLocalDate(existingContext.nextReviewDate) : undefined,
  );
  const { options, optionsError, isLoadingOptions, retryOptions } = useParkingResponsibleOptions();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    responsible?: string;
    reviewDate?: string;
  }>({});
  const [isSaving, setIsSaving] = useState(false);

  // A stored responsible person must remain selectable even when the option
  // list fails to load or no longer contains them.
  const selectableOptions =
    responsibleId !== '' && !options.some((option) => option.employeeRecordId === responsibleId)
      ? [
          {
            employeeRecordId: responsibleId,
            label: existingContext?.responsibleName ?? 'Aktuelle Person',
          },
          ...options,
        ]
      : options;

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!responsibleId) {
      setFieldErrors({ responsible: 'Bitte wähle eine verantwortliche Person aus.' });
      document.getElementById('parking-responsible')?.focus();
      return;
    }
    if (!reviewDate) {
      setFieldErrors({ reviewDate: 'Bitte wähle ein Datum für die Wiedervorlage.' });
      document.getElementById('parking-review-date')?.focus();
      return;
    }
    setFieldErrors({});
    setIsSaving(true);
    const releaseOperation = onSaveStart?.();
    try {
      const result = existingContext
        ? await setJobParkingContext({
            jobId,
            reason,
            note: note.trim() || null,
            responsibleEmployeeRecordId: responsibleId,
            nextReviewDate: reviewDate ? toLocalDateString(reviewDate) : '',
          })
        : await parkWorkTarget({
            targetType: 'job',
            targetId: jobId,
            expectedExecutionVersion,
            reason,
            ...(note.trim() ? { details: note.trim() } : {}),
            responsibleEmployeeRecordId: responsibleId,
            nextReviewDate: reviewDate ? toLocalDateString(reviewDate) : '',
          });
      if (!result.success) {
        onSaveFailed?.();
        // Parking codes first, then the shared sentences; a work-lifecycle code
        // from parkWorkTarget takes the calendar's sentence.
        setError(
          describeFailure(
            result.error,
            PARKING_ERROR_MESSAGES,
            calendarRefusalMessage(result.error) ?? SHARED_FAILURE_MESSAGES.unexpected_error,
          ),
        );
        return;
      }
      onSaved();
    } catch {
      onSaveFailed?.();
      setError(
        describeFailure('unexpected_error', PARKING_ERROR_MESSAGES, SHARED_FAILURE_MESSAGES.unexpected_error),
      );
    } finally {
      releaseOperation?.();
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} pending={isSaving}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Parkplatz-Kontext</DialogTitle>
          <DialogDescription>
            {`Warum ist „${jobTitle}“ geparkt, wer kümmert sich und wann wird wieder geprüft?`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} noValidate className="space-y-4">
          <Field label="Grund" htmlFor="parking-reason" required>
            {/* Ten reasons: at or above ten options the registry requires a searchable control. */}
            <SearchableSelect
              options={Object.entries(PARKING_REASON_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
              value={reason}
              onChange={(value) => setReason(value as JobParkingReason)}
              placeholder="Grund auswählen"
              searchPlaceholder="Grund suchen"
              emptyMessage="Kein passender Grund gefunden"
            />
          </Field>

          <Field label="Notiz (optional)" htmlFor="parking-note">
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="z. B. Kunde meldet sich nach dem Urlaub"
              maxLength={1000}
            />
          </Field>

          <Field
            label="Verantwortlich (Büro)"
            htmlFor="parking-responsible"
            required
            error={fieldErrors.responsible}
          >
            <SearchableSelect
              options={selectableOptions.map((option) => ({
                value: option.employeeRecordId,
                label: option.label,
              }))}
              value={responsibleId}
              onChange={(value) => {
                setResponsibleId(value);
                setFieldErrors({});
              }}
              placeholder="Person auswählen"
              searchPlaceholder="Person suchen …"
              emptyMessage="Keine Person gefunden"
            />
          </Field>
          <OptionsLoadError
            error={optionsError ? 'Die Personenliste konnte nicht geladen werden.' : null}
            onRetry={retryOptions}
            retrying={isLoadingOptions}
          />

          <Field label="Wiedervorlage" htmlFor="parking-review-date" required error={fieldErrors.reviewDate}>
            <DatePicker
              ariaLabel="Wiedervorlagedatum"
              value={reviewDate}
              onChange={(value) => {
                setReviewDate(value);
                setFieldErrors({});
              }}
              placeholder="Datum wählen"
            />
          </Field>

          <ErrorText>{error}</ErrorText>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              {isAlreadyParked ? 'Ohne Kontext lassen' : 'Abbrechen'}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              Kontext speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
