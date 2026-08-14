'use client';

// P1-12: Parkplatz context. Deliberate parking should record WHY, WHO is
// responsible, and WHEN to review. Dismissing keeps the job parked with the
// visible "Kontext fehlt" state — nothing is fabricated.

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

const NO_RESPONSIBLE = 'none';

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
  onClose,
  onSaved,
}: {
  jobId: string;
  jobTitle: string;
  existingContext: JobParkingContext | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState<JobParkingReason>(
    existingContext?.reason ?? 'sonstiges'
  );
  const [note, setNote] = useState(existingContext?.note ?? '');
  const [responsibleId, setResponsibleId] = useState<string>(
    existingContext?.responsibleEmployeeRecordId ?? NO_RESPONSIBLE
  );
  const [reviewDate, setReviewDate] = useState<Date | undefined>(
    fromIsoDate(existingContext?.nextReviewDate ?? null)
  );
  const [options, setOptions] = useState<ParkingResponsibleOption[]>([]);
  const [optionsError, setOptionsError] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    responsibleId !== NO_RESPONSIBLE &&
    !options.some((option) => option.employeeRecordId === responsibleId)
      ? [
          {
            employeeRecordId: responsibleId,
            label: existingContext?.responsibleName ?? 'Aktuelle Person',
          },
          ...options,
        ]
      : options;

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const result = await setJobParkingContext({
        jobId,
        reason,
        note: note.trim() || null,
        responsibleEmployeeRecordId:
          responsibleId === NO_RESPONSIBLE ? null : responsibleId,
        nextReviewDate: reviewDate ? toLocalIsoDate(reviewDate) : null,
      });
      if (!result.success) {
        setError(
          PARKING_ERROR_MESSAGES[result.error] ??
            PARKING_ERROR_MESSAGES.unexpected_error
        );
        return;
      }
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

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="parking-reason">Grund</Label>
            <Select
              value={reason}
              onValueChange={(value) => setReason(value as JobParkingReason)}
            >
              <SelectTrigger id="parking-reason" className="w-full">
                <SelectValue placeholder="Grund auswählen" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PARKING_REASON_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="parking-note">Notiz (optional)</Label>
            <Textarea
              id="parking-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="z. B. Kunde meldet sich nach dem Urlaub"
              maxLength={1000}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="parking-responsible">Verantwortlich (Büro)</Label>
            <Select value={responsibleId} onValueChange={setResponsibleId}>
              <SelectTrigger id="parking-responsible" className="w-full">
                <SelectValue placeholder="Person auswählen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_RESPONSIBLE}>
                  Keine Person hinterlegen
                </SelectItem>
                {selectableOptions.map((option) => (
                  <SelectItem
                    key={option.employeeRecordId}
                    value={option.employeeRecordId}
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {optionsError && (
              <p className="text-xs text-destructive">
                Die Personenliste konnte nicht geladen werden.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="parking-review-date">
              Wiedervorlage (optional)
            </Label>
            <DatePicker
              id="parking-review-date"
              ariaLabel="Wiedervorlagedatum"
              value={reviewDate}
              onChange={setReviewDate}
              placeholder="Datum wählen"
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Ohne Kontext lassen
          </Button>
          <Button disabled={isSaving} onClick={() => void handleSave()}>
            {isSaving && <Loader2 className="size-4 animate-spin" />}
            Kontext speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
