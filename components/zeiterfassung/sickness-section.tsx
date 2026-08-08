'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarCheck, Loader2, Thermometer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  cancelSicknessReport,
  endSicknessReport,
  getOwnSicknessReports,
  reportOwnSickness,
  type OwnSicknessOverview,
} from '@/lib/sickness/actions';
import {
  formatSicknessRange,
  SICKNESS_ERROR_MESSAGES,
  SICKNESS_EVIDENCE_LABELS,
  SICKNESS_TYPE_LABELS,
  type SicknessAbsenceType,
  type SicknessReport,
} from '@/lib/sickness/types';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import { cn, toLocalDateString } from '@/lib/utils';

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function SicknessSection() {
  const [overview, setOverview] = useState<OwnSicknessOverview | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [endReport, setEndReport] = useState<SicknessReport | null>(null);
  const [cancelReport, setCancelReport] = useState<SicknessReport | null>(null);
  const generationRef = useRef(0);
  const hasDataRef = useRef(false);

  const refetch = useCallback(async () => {
    const generation = ++generationRef.current;
    try {
      const result = await getOwnSicknessReports();
      if (generation !== generationRef.current) return;
      if (result.success) {
        hasDataRef.current = true;
        setOverview(result.overview);
        setLoadFailed(false);
      } else if (!hasDataRef.current) {
        // Keep last-known data on transient failure; only an initial load
        // failure shows the error state.
        setLoadFailed(true);
      }
    } catch (error) {
      console.error('Error fetching sickness overview:', error);
      if (generation === generationRef.current && !hasDataRef.current) {
        setLoadFailed(true);
      }
    } finally {
      if (generation === generationRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useRealtimeEvent('sickness_reports', () => {
    void refetch();
  });

  const activeReports = (overview?.reports ?? []).filter(
    (report) => report.status === 'reported'
  );
  const pastReports = (overview?.reports ?? []).filter(
    (report) => report.status !== 'reported'
  );

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground px-1">
        Krankmeldung
      </h3>

      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-56" />
            </div>
          ) : loadFailed ? (
            <p className="text-sm text-muted-foreground">
              Die Krankmeldungen konnten nicht geladen werden.
            </p>
          ) : (
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted">
                <Thermometer className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Krank oder verhindert?</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Melde deine Abwesenheit mit wenigen Angaben. Ein Enddatum
                  kannst du später nachtragen.
                </p>
                <div className="mt-3">
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setShowReportDialog(true)}
                    disabled={!overview?.employeeRecordId}
                  >
                    <Thermometer className="size-3.5" />
                    Krank melden
                  </Button>
                  {overview && !overview.employeeRecordId && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {SICKNESS_ERROR_MESSAGES.no_employee_record}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {overview && (activeReports.length > 0 || pastReports.length > 0) && (
        <Card>
          <CardContent className="p-4">
            <h4 className="mb-2 text-sm font-medium">Meine Krankmeldungen</h4>
            <ul className="grid gap-2">
              {[...activeReports, ...pastReports].map((report) => (
                <li key={report.id} className="rounded-md border px-3 py-2.5">
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
                          {report.status === 'reported'
                            ? 'Aktiv'
                            : 'Storniert'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {SICKNESS_TYPE_LABELS[report.absenceType]}
                        {report.dayPortion === 'half_day' ? ' · Halbtägig' : ''}
                        {report.evidenceRequired
                          ? ` · ${SICKNESS_EVIDENCE_LABELS[report.evidenceStatus]}`
                          : ''}
                      </p>
                    </div>
                    {report.status === 'reported' && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => setEndReport(report)}
                          aria-label={`Enddatum für die Krankmeldung vom ${formatSicknessRange(report)} setzen`}
                        >
                          <CalendarCheck className="size-3.5" />
                          {report.endDate === null
                            ? 'Enddatum setzen'
                            : 'Enddatum ändern'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground"
                          onClick={() => setCancelReport(report)}
                          aria-label={`Krankmeldung vom ${formatSicknessRange(report)} stornieren`}
                        >
                          Stornieren
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {showReportDialog && (
        <SicknessReportDialog
          onClose={(saved) => {
            setShowReportDialog(false);
            if (saved) void refetch();
          }}
        />
      )}

      {endReport && (
        <SicknessEndDialog
          report={endReport}
          onClose={(saved) => {
            setEndReport(null);
            if (saved) void refetch();
          }}
        />
      )}

      {cancelReport && (
        <SicknessCancelDialog
          report={cancelReport}
          onClose={(saved) => {
            setCancelReport(null);
            if (saved) void refetch();
          }}
        />
      )}
    </div>
  );
}

function SicknessReportDialog({
  onClose,
}: {
  onClose: (saved: boolean) => void;
}) {
  const todayIso = toLocalDateString(new Date());
  const [absenceType, setAbsenceType] =
    useState<SicknessAbsenceType>('krankheit');
  const [startDate, setStartDate] = useState<string>(todayIso);
  const [endKnown, setEndKnown] = useState(false);
  const [endDate, setEndDate] = useState<string>(todayIso);
  const [halfDay, setHalfDay] = useState(false);
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
          SICKNESS_ERROR_MESSAGES[result.error] ??
            'Die Meldung konnte nicht gespeichert werden.'
        );
      }
    } catch (submitError) {
      console.error('Error reporting sickness:', submitError);
      setError('Die Meldung konnte nicht gespeichert werden.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !isSaving && onClose(overlapHint)}
    >
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Krank melden</DialogTitle>
          <DialogDescription>
            Dein Betrieb wird informiert. Es werden keine Krankheitsdetails
            abgefragt – bitte gib keine Diagnose an.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="sickness-type">Art</Label>
              <Select
                value={absenceType}
                onValueChange={(value) =>
                  setAbsenceType(value as SicknessAbsenceType)
                }
                disabled={isSaving}
              >
                <SelectTrigger id="sickness-type" aria-label="Art">
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
              <Label htmlFor="sickness-start-date">Ab</Label>
              <DatePicker
                id="sickness-start-date"
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
              <div className="grid gap-2">
                <Label htmlFor="sickness-end-date">Bis</Label>
                <DatePicker
                  id="sickness-end-date"
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
                Ohne Enddatum gilt die Meldung bis auf Weiteres. Du kannst das
                Enddatum später nachtragen.
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

            {overlapHint && (
              <p role="status" className="text-xs text-muted-foreground">
                Hinweis: Der Zeitraum überschneidet sich mit genehmigtem Urlaub.
                Dein Büro entscheidet, wie damit umgegangen wird.
              </p>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
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
                  {isSaving ? 'Wird gemeldet...' : 'Krank melden'}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SicknessEndDialog({
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
      const result = await endSicknessReport({
        reportId: report.id,
        endDate,
      });
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
            Krankmeldung ab {formatDate(report.startDate)}. Mit dem Enddatum
            endet die Abwesenheit.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="sickness-end-date-edit">Letzter Tag</Label>
              <DatePicker
                id="sickness-end-date-edit"
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

function SicknessCancelDialog({
  report,
  onClose,
}: {
  report: SicknessReport;
  onClose: (saved: boolean) => void;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (isSaving) return;
    setError(null);
    setIsSaving(true);
    try {
      const result = await cancelSicknessReport({ reportId: report.id });
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
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Krankmeldung stornieren</DialogTitle>
          <DialogDescription>
            Die Krankmeldung vom {formatSicknessRange(report)} wird storniert
            und zählt nicht mehr als Abwesenheit.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
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
            type="button"
            variant="destructive"
            onClick={() => void handleConfirm()}
            disabled={isSaving}
          >
            {isSaving && <Loader2 className="size-4 animate-spin" />}
            {isSaving ? 'Wird storniert...' : 'Stornieren'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
