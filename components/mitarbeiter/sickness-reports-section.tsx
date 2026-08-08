'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarCheck,
  FileCheck,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Thermometer,
  XCircle,
} from 'lucide-react';

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  cancelSicknessReport,
  correctSicknessReport,
  endSicknessReport,
  getSicknessReportsForRecord,
  recordSicknessForMember,
  setSicknessEvidence,
} from '@/lib/sickness/actions';
import {
  formatSicknessRange,
  SICKNESS_EVIDENCE_LABELS,
  SICKNESS_TYPE_LABELS,
  type SicknessAbsenceType,
  type SicknessReport,
} from '@/lib/sickness/types';
import { SICKNESS_ERROR_MESSAGES } from '@/components/zeiterfassung/sickness-section';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import { cn, toLocalDateString } from '@/lib/utils';

// Manager surface (privacy matrix): admin/büro see type and evidence state
// here — the shared calendar stays neutral. There is deliberately no note
// field and nothing that could hold a diagnosis.

type DialogState =
  | { mode: 'closed' }
  | { mode: 'record' }
  | { mode: 'end'; report: SicknessReport }
  | { mode: 'correct'; report: SicknessReport }
  | { mode: 'evidence'; report: SicknessReport }
  | { mode: 'cancel'; report: SicknessReport };

export function SicknessReportsSection({ recordId }: { recordId: string }) {
  const [reports, setReports] = useState<SicknessReport[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogState, setDialogState] = useState<DialogState>({
    mode: 'closed',
  });
  const generationRef = useRef(0);
  const hasDataRef = useRef(false);

  const refetch = useCallback(async () => {
    const generation = ++generationRef.current;
    try {
      const result = await getSicknessReportsForRecord(recordId);
      if (generation !== generationRef.current) return;
      if (result.success) {
        hasDataRef.current = true;
        setReports(result.reports);
        setLoadFailed(false);
      } else if (!hasDataRef.current) {
        setLoadFailed(true);
      }
    } catch (error) {
      console.error('Error fetching sickness reports:', error);
      if (generation === generationRef.current && !hasDataRef.current) {
        setLoadFailed(true);
      }
    } finally {
      if (generation === generationRef.current) {
        setIsLoading(false);
      }
    }
  }, [recordId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useRealtimeEvent('sickness_reports', () => {
    void refetch();
  });

  const closeDialog = useCallback(
    (saved: boolean) => {
      setDialogState({ mode: 'closed' });
      if (saved) void refetch();
    },
    [refetch]
  );

  const sorted = [...(reports ?? [])].sort((a, b) =>
    b.startDate.localeCompare(a.startDate)
  );

  return (
    <section className="space-y-3" data-testid="sickness-reports-section">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Thermometer className="size-4" />
          Krankmeldungen
        </h3>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setDialogState({ mode: 'record' })}
        >
          <Plus className="size-3.5" />
          Krankmeldung erfassen
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : loadFailed && !reports ? (
        <p role="alert" className="text-sm text-destructive">
          Die Krankmeldungen konnten nicht geladen werden.
        </p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Keine Krankmeldungen erfasst.
        </p>
      ) : (
        <ul className="grid gap-2">
          {sorted.map((report) => (
            <li
              key={report.id}
              className="rounded-md border px-3 py-2.5"
              data-sickness-report={report.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium tabular-nums">
                      {formatSicknessRange(report)}
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                        report.status === 'reported'
                          ? 'bg-brand-purple/15 text-brand-purple-dark dark:text-brand-purple-light'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {report.status === 'reported' ? 'Aktiv' : 'Storniert'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {SICKNESS_TYPE_LABELS[report.absenceType]}
                    {report.dayPortion === 'half_day' ? ' · Halbtägig' : ''}
                    {` · ${SICKNESS_EVIDENCE_LABELS[report.evidenceStatus]}`}
                  </p>
                  {report.status === 'cancelled' &&
                    report.cancellationReason && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Storniert: {report.cancellationReason}
                      </p>
                    )}
                </div>
                {report.status === 'reported' && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Aktionen für die Krankmeldung vom ${formatSicknessRange(report)}`}
                      >
                        <MoreVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => setDialogState({ mode: 'end', report })}
                      >
                        <CalendarCheck className="size-4" />
                        {report.endDate === null
                          ? 'Enddatum setzen'
                          : 'Enddatum ändern'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          setDialogState({ mode: 'correct', report })
                        }
                      >
                        <Pencil className="size-4" />
                        Korrigieren
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          setDialogState({ mode: 'evidence', report })
                        }
                      >
                        <FileCheck className="size-4" />
                        Nachweis verwalten
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() =>
                          setDialogState({ mode: 'cancel', report })
                        }
                      >
                        <XCircle className="size-4" />
                        Stornieren
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialogState.mode === 'record' && (
        <RecordSicknessDialog recordId={recordId} onClose={closeDialog} />
      )}
      {dialogState.mode === 'end' && (
        <ManagerEndDialog report={dialogState.report} onClose={closeDialog} />
      )}
      {dialogState.mode === 'correct' && (
        <CorrectSicknessDialog
          report={dialogState.report}
          onClose={closeDialog}
        />
      )}
      {dialogState.mode === 'evidence' && (
        <EvidenceDialog report={dialogState.report} onClose={closeDialog} />
      )}
      {dialogState.mode === 'cancel' && (
        <ManagerCancelDialog
          report={dialogState.report}
          onClose={closeDialog}
        />
      )}
    </section>
  );
}

function RecordSicknessDialog({
  recordId,
  onClose,
}: {
  recordId: string;
  onClose: (saved: boolean) => void;
}) {
  const todayIso = toLocalDateString(new Date());
  const [absenceType, setAbsenceType] =
    useState<SicknessAbsenceType>('krankheit');
  const [startDate, setStartDate] = useState<string>(todayIso);
  const [endKnown, setEndKnown] = useState(false);
  const [endDate, setEndDate] = useState<string>(todayIso);
  const [halfDay, setHalfDay] = useState(false);
  const [evidenceRequired, setEvidenceRequired] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlapHint, setOverlapHint] = useState(false);

  const isSingleDay = endKnown && startDate === endDate;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);

    if (!startDate || (endKnown && !endDate)) {
      setError('Bitte wähle die Daten aus.');
      return;
    }
    if (endKnown && endDate < startDate) {
      setError(SICKNESS_ERROR_MESSAGES.invalid_range);
      return;
    }

    setIsSaving(true);
    try {
      const result = await recordSicknessForMember({
        employeeRecordId: recordId,
        absenceType,
        startDate,
        endDate: endKnown ? endDate : null,
        dayPortion: halfDay && isSingleDay ? 'half_day' : 'full',
        evidenceRequired,
      });
      if (result.success) {
        if (result.vacationOverlap) {
          setOverlapHint(true);
          setTimeout(() => onClose(true), 2500);
        } else {
          onClose(true);
        }
      } else {
        setError(
          SICKNESS_ERROR_MESSAGES[result.error] ??
            'Die Meldung konnte nicht gespeichert werden.'
        );
      }
    } catch (submitError) {
      console.error('Error recording sickness:', submitError);
      setError('Die Meldung konnte nicht gespeichert werden.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !isSaving && onClose(false)}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Krankmeldung erfassen</DialogTitle>
          <DialogDescription>
            Für telefonische oder persönliche Meldungen. Es werden keine
            Krankheitsdetails erfasst.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="record-sickness-type">Art</Label>
              <Select
                value={absenceType}
                onValueChange={(value) =>
                  setAbsenceType(value as SicknessAbsenceType)
                }
                disabled={isSaving}
              >
                <SelectTrigger id="record-sickness-type" aria-label="Art">
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
            </div>

            <div className="grid gap-2">
              <Label htmlFor="record-sickness-start">Ab</Label>
              <DatePicker
                id="record-sickness-start"
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
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="record-sickness-end-known"
                checked={endKnown}
                onCheckedChange={(checked) => setEndKnown(checked === true)}
                disabled={isSaving}
              />
              <Label
                htmlFor="record-sickness-end-known"
                className="text-sm font-normal"
              >
                Enddatum ist schon bekannt
              </Label>
            </div>

            {endKnown ? (
              <div className="grid gap-2">
                <Label htmlFor="record-sickness-end">Bis</Label>
                <DatePicker
                  id="record-sickness-end"
                  ariaLabel="Bis"
                  value={endDate ? new Date(`${endDate}T00:00:00`) : undefined}
                  onChange={(date) =>
                    setEndDate(date ? toLocalDateString(date) : '')
                  }
                  disabled={isSaving}
                />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Ohne Enddatum gilt die Meldung bis auf Weiteres.
              </p>
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
                  className={cn(
                    'text-sm font-normal',
                    !isSingleDay && 'text-muted-foreground'
                  )}
                >
                  Halbtägig
                  {!isSingleDay && ' – nur bei einem einzelnen Tag'}
                </Label>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Checkbox
                id="record-sickness-evidence"
                checked={evidenceRequired}
                onCheckedChange={(checked) =>
                  setEvidenceRequired(checked === true)
                }
                disabled={isSaving}
              />
              <Label
                htmlFor="record-sickness-evidence"
                className="text-sm font-normal"
              >
                Nachweis erforderlich (Entscheidung des Betriebs)
              </Label>
            </div>

            {overlapHint && (
              <p role="status" className="text-xs text-muted-foreground">
                Hinweis: Der Zeitraum überschneidet sich mit genehmigtem Urlaub.
                Eine Anpassung des Urlaubs bleibt eine bewusste Entscheidung
                über die Urlaubsverwaltung.
              </p>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onClose(false)}
              disabled={isSaving}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={isSaving || !startDate || (endKnown && !endDate)}
            >
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              {isSaving ? 'Wird gespeichert...' : 'Krankmeldung erfassen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ManagerEndDialog({
  report,
  onClose,
}: {
  report: SicknessReport;
  onClose: (saved: boolean) => void;
}) {
  const todayIso = toLocalDateString(new Date());
  const [endDate, setEndDate] = useState<string>(
    report.endDate ?? (todayIso >= report.startDate ? todayIso : report.startDate)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);
    if (!endDate) {
      setError('Bitte wähle ein Enddatum aus.');
      return;
    }

    setIsSaving(true);
    try {
      const result = await endSicknessReport({ reportId: report.id, endDate });
      if (result.success) {
        onClose(true);
      } else {
        setError(
          SICKNESS_ERROR_MESSAGES[result.error] ??
            'Das Enddatum konnte nicht gespeichert werden.'
        );
      }
    } catch (submitError) {
      console.error('Error ending sickness report:', submitError);
      setError('Das Enddatum konnte nicht gespeichert werden.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !isSaving && onClose(false)}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Enddatum setzen</DialogTitle>
          <DialogDescription>
            Krankmeldung vom {formatSicknessRange(report)}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="manager-sickness-end">Letzter Tag</Label>
              <DatePicker
                id="manager-sickness-end"
                ariaLabel="Letzter Tag"
                value={endDate ? new Date(`${endDate}T00:00:00`) : undefined}
                onChange={(date) =>
                  setEndDate(date ? toLocalDateString(date) : '')
                }
                disabled={isSaving}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onClose(false)}
              disabled={isSaving}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={isSaving || !endDate}>
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              {isSaving ? 'Wird gespeichert...' : 'Enddatum speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CorrectSicknessDialog({
  report,
  onClose,
}: {
  report: SicknessReport;
  onClose: (saved: boolean) => void;
}) {
  const [absenceType, setAbsenceType] = useState<SicknessAbsenceType>(
    report.absenceType
  );
  const [startDate, setStartDate] = useState<string>(report.startDate);
  const [endKnown, setEndKnown] = useState(report.endDate !== null);
  const [endDate, setEndDate] = useState<string>(
    report.endDate ?? report.startDate
  );
  const [halfDay, setHalfDay] = useState(report.dayPortion === 'half_day');
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSingleDay = endKnown && startDate === endDate;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);

    if (!startDate || (endKnown && !endDate)) {
      setError('Bitte wähle die Daten aus.');
      return;
    }
    if (!reason.trim()) {
      setError('Bitte gib einen Grund für die Korrektur an.');
      return;
    }

    setIsSaving(true);
    try {
      const result = await correctSicknessReport({
        reportId: report.id,
        absenceType,
        startDate,
        endDate: endKnown ? endDate : null,
        dayPortion: halfDay && isSingleDay ? 'half_day' : 'full',
        reason: reason.trim(),
      });
      if (result.success) {
        onClose(true);
      } else {
        setError(
          SICKNESS_ERROR_MESSAGES[result.error] ??
            'Die Korrektur konnte nicht gespeichert werden.'
        );
      }
    } catch (submitError) {
      console.error('Error correcting sickness report:', submitError);
      setError('Die Korrektur konnte nicht gespeichert werden.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !isSaving && onClose(false)}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Krankmeldung korrigieren</DialogTitle>
          <DialogDescription>
            Jede Korrektur bleibt im Verlauf nachvollziehbar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="correct-sickness-type">Art</Label>
              <Select
                value={absenceType}
                onValueChange={(value) =>
                  setAbsenceType(value as SicknessAbsenceType)
                }
                disabled={isSaving}
              >
                <SelectTrigger id="correct-sickness-type" aria-label="Art">
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
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="correct-sickness-start">Ab</Label>
                <DatePicker
                  id="correct-sickness-start"
                  ariaLabel="Ab"
                  value={
                    startDate ? new Date(`${startDate}T00:00:00`) : undefined
                  }
                  onChange={(date) => {
                    const next = date ? toLocalDateString(date) : '';
                    setStartDate(next);
                    if (next && endKnown && (!endDate || endDate < next)) {
                      setEndDate(next);
                    }
                  }}
                  disabled={isSaving}
                />
              </div>
              {endKnown && (
                <div className="grid gap-2">
                  <Label htmlFor="correct-sickness-end">Bis</Label>
                  <DatePicker
                    id="correct-sickness-end"
                    ariaLabel="Bis"
                    value={endDate ? new Date(`${endDate}T00:00:00`) : undefined}
                    onChange={(date) =>
                      setEndDate(date ? toLocalDateString(date) : '')
                    }
                    disabled={isSaving}
                  />
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="correct-sickness-end-known"
                checked={endKnown}
                onCheckedChange={(checked) => setEndKnown(checked === true)}
                disabled={isSaving}
              />
              <Label
                htmlFor="correct-sickness-end-known"
                className="text-sm font-normal"
              >
                Enddatum ist bekannt
              </Label>
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
                  className={cn(
                    'text-sm font-normal',
                    !isSingleDay && 'text-muted-foreground'
                  )}
                >
                  Halbtägig
                  {!isSingleDay && ' – nur bei einem einzelnen Tag'}
                </Label>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="correct-sickness-reason">Grund</Label>
              <Textarea
                id="correct-sickness-reason"
                rows={2}
                placeholder="z. B. Datum telefonisch korrigiert"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={isSaving}
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onClose(false)}
              disabled={isSaving}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={
                isSaving || !startDate || (endKnown && !endDate) || !reason.trim()
              }
            >
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              {isSaving ? 'Wird gespeichert...' : 'Korrektur speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EvidenceDialog({
  report,
  onClose,
}: {
  report: SicknessReport;
  onClose: (saved: boolean) => void;
}) {
  const [evidenceRequired, setEvidenceRequired] = useState(
    report.evidenceRequired
  );
  const [received, setReceived] = useState(
    report.evidenceStatus === 'received'
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);
    setIsSaving(true);
    try {
      const result = await setSicknessEvidence({
        reportId: report.id,
        evidenceRequired,
        evidenceStatus: evidenceRequired
          ? received
            ? 'received'
            : 'pending'
          : 'not_required',
      });
      if (result.success) {
        onClose(true);
      } else {
        setError(
          SICKNESS_ERROR_MESSAGES[result.error] ??
            'Der Nachweis-Status konnte nicht gespeichert werden.'
        );
      }
    } catch (submitError) {
      console.error('Error updating sickness evidence:', submitError);
      setError('Der Nachweis-Status konnte nicht gespeichert werden.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !isSaving && onClose(false)}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Nachweis verwalten</DialogTitle>
          <DialogDescription>
            Ob ein Nachweis verlangt wird, entscheidet der Betrieb. WerkFlow
            vermerkt nur den Status – Dateien werden hier nicht gespeichert.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="evidence-required"
                checked={evidenceRequired}
                onCheckedChange={(checked) =>
                  setEvidenceRequired(checked === true)
                }
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
                <Label
                  htmlFor="evidence-received"
                  className="text-sm font-normal"
                >
                  Nachweis erhalten
                </Label>
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onClose(false)}
              disabled={isSaving}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              {isSaving ? 'Wird gespeichert...' : 'Speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ManagerCancelDialog({
  report,
  onClose,
}: {
  report: SicknessReport;
  onClose: (saved: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);
    if (!reason.trim()) {
      setError('Bitte gib einen Grund für die Stornierung an.');
      return;
    }
    setIsSaving(true);
    try {
      const result = await cancelSicknessReport({
        reportId: report.id,
        reason: reason.trim(),
      });
      if (result.success) {
        onClose(true);
      } else {
        setError(
          SICKNESS_ERROR_MESSAGES[result.error] ??
            'Die Meldung konnte nicht storniert werden.'
        );
      }
    } catch (submitError) {
      console.error('Error cancelling sickness report:', submitError);
      setError('Die Meldung konnte nicht storniert werden.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !isSaving && onClose(false)}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Krankmeldung stornieren</DialogTitle>
          <DialogDescription>
            Die Krankmeldung vom {formatSicknessRange(report)} wird storniert
            und zählt nicht mehr als Abwesenheit.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="cancel-sickness-reason">Grund</Label>
              <Textarea
                id="cancel-sickness-reason"
                rows={2}
                placeholder="z. B. versehentlich erfasst"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={isSaving}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onClose(false)}
              disabled={isSaving}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={isSaving || !reason.trim()}
            >
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              {isSaving ? 'Wird storniert...' : 'Stornieren'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
