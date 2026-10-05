'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useServerAction } from '@/hooks/use-server-action';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { useBanner } from '@/components/ui/banner';
import { describeFailure } from '@/lib/action-messages';
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
import { Textarea } from '@/components/ui/textarea';
import { cancelSicknessReport, endSicknessReport, setSicknessEvidence } from '@/lib/sickness/actions';
import { formatSicknessRange, SICKNESS_ERROR_MESSAGES, type SicknessReport } from '@/lib/sickness/types';
import { toLocalDateString } from '@/lib/utils';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import { logError } from '@/lib/logging';

export function ManagerEndDialog({
  report,
  onClose,
}: {
  report: SicknessReport;
  onClose: (saved: boolean) => void;
}) {
  const todayIso = getBusinessTodayIso();
  const { showBanner } = useBanner();
  const [endDate, setEndDate] = useState<string>(
    report.endDate ?? (todayIso >= report.startDate ? todayIso : report.startDate),
  );
  const { run: runSave, isPending: isSaving } = useServerAction(endSicknessReport);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);
    if (!endDate) {
      setError('Bitte wähle ein Enddatum aus.');
      document.getElementById('manager-sickness-end')?.focus();
      return;
    }

    try {
      const result = await runSave({ reportId: report.id, endDate });
      if (result.success) {
        showBanner({
          variant: 'success',
          message: 'Das Enddatum wurde gespeichert.',
        });
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
    } catch (submitError) {
      logError('Error ending sickness report:', submitError);
      setError('Das Enddatum konnte nicht gespeichert werden.');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)} pending={isSaving}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Enddatum setzen</DialogTitle>
          <DialogDescription>Krankmeldung vom {formatSicknessRange(report)}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-4">
            <Field label="Letzter Tag" htmlFor="manager-sickness-end" required>
              <DatePicker
                ariaLabel="Letzter Tag"
                value={endDate ? new Date(`${endDate}T00:00:00`) : undefined}
                onChange={(date) => setEndDate(date ? toLocalDateString(date) : '')}
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
              {isSaving ? 'Wird gespeichert…' : 'Enddatum speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EvidenceDialog({
  report,
  onClose,
}: {
  report: SicknessReport;
  onClose: (saved: boolean) => void;
}) {
  const { showBanner } = useBanner();
  const [evidenceRequired, setEvidenceRequired] = useState(report.evidenceRequired);
  const [received, setReceived] = useState(report.evidenceStatus === 'received');
  const { run: runSave, isPending: isSaving } = useServerAction(setSicknessEvidence);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);
    try {
      const result = await runSave({
        reportId: report.id,
        evidenceRequired,
        evidenceStatus: evidenceRequired ? (received ? 'received' : 'pending') : 'not_required',
      });
      if (result.success) {
        showBanner({
          variant: 'success',
          message: 'Der Nachweis-Status wurde gespeichert.',
        });
        onClose(true);
      } else {
        setError(
          describeFailure(
            result.error,
            SICKNESS_ERROR_MESSAGES,
            'Der Nachweis-Status konnte nicht gespeichert werden.',
          ),
        );
      }
    } catch (submitError) {
      logError('Error updating sickness evidence:', submitError);
      setError('Der Nachweis-Status konnte nicht gespeichert werden.');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)} pending={isSaving}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Nachweis verwalten</DialogTitle>
          <DialogDescription>
            Ob ein Nachweis verlangt wird, entscheidet der Betrieb. WerkFlow vermerkt nur den Status – Dateien
            werden hier nicht gespeichert.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="evidence-required"
                checked={evidenceRequired}
                onCheckedChange={(checked) => setEvidenceRequired(checked === true)}
                disabled={isSaving}
              />
              <Label htmlFor="evidence-required" className="text-sm font-normal">
                Nachweis erforderlich
              </Label>
            </div>

            {evidenceRequired && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="evidence-received"
                  checked={received}
                  onCheckedChange={(checked) => setReceived(checked === true)}
                  disabled={isSaving}
                />
                <Label htmlFor="evidence-received" className="text-sm font-normal">
                  Nachweis erhalten
                </Label>
              </div>
            )}

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

export function ManagerCancelDialog({
  report,
  onClose,
}: {
  report: SicknessReport;
  onClose: (saved: boolean) => void;
}) {
  const { showBanner } = useBanner();
  const [reason, setReason] = useState('');
  const { run: runSave, isPending: isSaving } = useServerAction(cancelSicknessReport);
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);
    if (!reason.trim()) {
      setReasonError('Bitte gib einen Grund für die Stornierung an.');
      document.getElementById('cancel-sickness-reason')?.focus();
      return;
    }
    try {
      const result = await runSave({
        reportId: report.id,
        reason: reason.trim(),
      });
      if (result.success) {
        showBanner({
          variant: 'success',
          message: 'Die Krankmeldung wurde storniert.',
        });
        onClose(true);
      } else {
        setError(
          describeFailure(
            result.error,
            SICKNESS_ERROR_MESSAGES,
            'Die Meldung konnte nicht storniert werden.',
          ),
        );
      }
    } catch (submitError) {
      logError('Error cancelling sickness report:', submitError);
      setError('Die Meldung konnte nicht storniert werden.');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)} pending={isSaving}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Krankmeldung stornieren</DialogTitle>
          <DialogDescription>
            Die Krankmeldung vom {formatSicknessRange(report)} wird storniert und zählt nicht mehr als
            Abwesenheit.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-4">
            <Field label="Grund" htmlFor="cancel-sickness-reason" required error={reasonError}>
              <Textarea
                placeholder="z. B. versehentlich erfasst"
                value={reason}
                onChange={(e) => {
                  setReasonError(null);
                  setReason(e.target.value);
                }}
                disabled={isSaving}
              />
            </Field>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onClose(false)} disabled={isSaving}>
              Abbrechen
            </Button>
            <Button type="submit" variant="destructive" disabled={isSaving}>
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              {isSaving ? 'Wird storniert…' : 'Stornieren'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
