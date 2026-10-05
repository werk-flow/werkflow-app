'use client';

import { useState } from 'react';
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
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { endSicknessReport } from '@/lib/sickness/actions';
import { SICKNESS_ERROR_MESSAGES, type SicknessReport } from '@/lib/sickness/types';
import { describeFailure } from '@/lib/action-messages';
import { toLocalDateString, formatGermanDate } from '@/lib/utils';
import { getBusinessTodayIso } from '@/lib/personnel/types';

export function OwnSicknessEndDialog({
  report,
  onClose,
}: {
  report: SicknessReport;
  onClose: (saved: boolean) => void;
}) {
  const todayIso = getBusinessTodayIso();
  const [endDate, setEndDate] = useState<string>(
    report.endDate ?? (todayIso >= report.startDate ? todayIso : report.startDate),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);
    if (!endDate) {
      setError('Bitte wähle ein Enddatum aus.');
      document.getElementById('sickness-end-date-edit')?.focus();
      return;
    }

    setIsSaving(true);
    try {
      const result = await endSicknessReport({
        reportId: report.id,
        endDate,
      });
      if (result.success) {
        onClose(true);
      } else {
        setError(
          describeFailure(
            result.error,
            SICKNESS_ERROR_MESSAGES,
            'Das Enddatum konnte nicht gespeichert werden.',
          ),
        );
      }
    } catch {
      setError('Das Enddatum konnte nicht gespeichert werden.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)} pending={isSaving}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Enddatum setzen</DialogTitle>
          <DialogDescription>
            Krankmeldung ab {formatGermanDate(report.startDate)}. Mit dem Enddatum endet die Abwesenheit.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <Field label="Letzter Tag" htmlFor="sickness-end-date-edit" required>
              <DatePicker
                ariaLabel="Letzter Tag"
                value={endDate ? new Date(`${endDate}T00:00:00`) : undefined}
                onChange={(date) => setEndDate(date ? toLocalDateString(date) : '')}
                disabled={isSaving}
              />
            </Field>
            <ErrorText>{error}</ErrorText>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onClose(false)} disabled={isSaving}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              {isSaving ? 'Wird gespeichert…' : 'Enddatum speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
