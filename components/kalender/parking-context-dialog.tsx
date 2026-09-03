'use client';

// P1-12: Parkplatz context. Deliberate parking should record WHY, WHO is
// responsible, and WHEN to review. Dismissing keeps the job parked with the
// visible "Kontext fehlt" state — nothing is fabricated.

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { useBanner } from '@/components/ui/banner';
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
import { parkWorkTarget } from '@/lib/work-lifecycle/actions';

function toLocalIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fromIsoDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function ParkingContextDialog({
  jobId,
  jobTitle,
  existingContext,
  expectedExecutionVersion,
  isAlreadyParked,
  onClose,
  onSaved,
}: {
  jobId: string;
  jobTitle: string;
  existingContext: JobParkingContext | null;
  expectedExecutionVersion: number;
  isAlreadyParked: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showBanner } = useBanner();
  const [reason, setReason] = useState<JobParkingReason>(
    existingContext?.reason ?? 'other'
  );
  const [note, setNote] = useState(existingContext?.note ?? '');
  const [responsibleId, setResponsibleId] = useState<string>(
    existingContext?.responsibleEmployeeRecordId ?? ''
  );
  const [reviewDate, setReviewDate] = useState<Date | undefined>(
    fromIsoDate(existingContext?.nextReviewDate ?? null)
  );
  const [options, setOptions] = useState<ParkingResponsibleOption[]>([]);
  const [optionsError, setOptionsError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    responsible?: string;
    reviewDate?: string;
  }>({});
  const [isSaving, setIsSaving] = useState(false);

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
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A stored responsible person must remain selectable even when the option
  // list fails to load or no longer contains them.
  const selectableOptions =
    responsibleId !== '' &&
    !options.some((option) => option.employeeRecordId === responsibleId)
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
    try {
      const result = existingContext
        ? await setJobParkingContext({
            jobId,
            reason,
            note: note.trim() || null,
            responsibleEmployeeRecordId: responsibleId,
            nextReviewDate: reviewDate ? toLocalIsoDate(reviewDate) : '',
          })
        : await parkWorkTarget({
            targetType: 'job',
            targetId: jobId,
            expectedExecutionVersion,
            reason,
            details: note.trim() || undefined,
            responsibleEmployeeRecordId: responsibleId,
            nextReviewDate: reviewDate ? toLocalIsoDate(reviewDate) : '',
          });
      if (!result.success) {
        setError(
          PARKING_ERROR_MESSAGES[result.error] ??
            PARKING_ERROR_MESSAGES.unexpected_error
        );
        return;
      }
      showBanner({
        variant: 'success',
        message: 'Parkplatz-Kontext wurde gespeichert.',
      });
      onSaved();
    } catch {
      setError(PARKING_ERROR_MESSAGES.unexpected_error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
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
            error={
              optionsError
                ? 'Die Personenliste konnte nicht geladen werden.'
                : fieldErrors.responsible
            }
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

          <Field
            label="Wiedervorlage"
            htmlFor="parking-review-date"
            required
            error={fieldErrors.reviewDate}
          >
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
            <Button type="button" variant="outline" onClick={onClose}>
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
