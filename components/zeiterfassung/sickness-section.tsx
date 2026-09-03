'use client';

import { useState } from 'react';
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
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { InlinePending } from '@/components/ui/inline-pending';
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
import { useBusyIds } from '@/hooks/use-busy-id';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { cn, toLocalDateString } from '@/lib/utils';

// Settle key for a report that has no row yet; report ids are UUIDs.
const NEW_REPORT_ID = 'new';

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function SicknessSection() {
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [endReport, setEndReport] = useState<SicknessReport | null>(null);
  const [cancelReport, setCancelReport] = useState<SicknessReport | null>(null);

  const view = useLiveView<OwnSicknessOverview>({
    tables: ['sickness_reports'],
    read: async (): Promise<LiveViewResult<OwnSicknessOverview>> => {
      const result = await getOwnSicknessReports();
      return result.success
        ? { ok: true, data: result.overview }
        : { ok: false };
    },
  });

  const overview = view.data ?? null;
  const isLoading = view.isLoading;
  // Keep last-known data on transient failure; only an initial load that
  // never produced data shows the error state.
  const loadFailed = !isLoading && overview === null;
  // A dialog closes as soon as the server saved; the affected row (or the
  // section header for a new report) shows the settle spinner until the
  // authoritative read lands.
  const settling = useBusyIds();
  const settle = (id: string) => void settling.run(id, view.refresh);

  const activeReports = (overview?.reports ?? []).filter(
    (report) => report.status === 'reported'
  );
  const pastReports = (overview?.reports ?? []).filter(
    (report) => report.status !== 'reported'
  );

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground px-1">
        Krankmeldung
        <InlinePending active={settling.isBusy(NEW_REPORT_ID)} />
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
                        <InlinePending active={settling.isBusy(report.id)} />
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
                          disabled={settling.isBusy(report.id)}
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
                          disabled={settling.isBusy(report.id)}
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
            if (saved) settle(NEW_REPORT_ID);
          }}
        />
      )}

      {endReport && (
        <SicknessEndDialog
          report={endReport}
          onClose={(saved) => {
            setEndReport(null);
            if (saved) settle(endReport.id);
          }}
        />
      )}

      {cancelReport && (
        <SicknessCancelDialog
          report={cancelReport}
          onClose={(saved) => {
            setCancelReport(null);
            if (saved) settle(cancelReport.id);
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
  const [dateErrors, setDateErrors] = useState<{ start?: string; end?: string }>({});

  const isSingleDay = endKnown && startDate === endDate;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);

    const nextDateErrors = {
      start: startDate ? undefined : 'Bitte wähle ein Datum aus.',
      end:
        endKnown && !endDate
          ? 'Bitte wähle ein Datum aus.'
          : endKnown && endDate < startDate
            ? SICKNESS_ERROR_MESSAGES.invalid_range
            : undefined,
    };
    setDateErrors(nextDateErrors);
    if (nextDateErrors.start || nextDateErrors.end) {
      document
        .getElementById(
          nextDateErrors.start ? 'sickness-start-date' : 'sickness-end-date'
        )
        ?.focus();
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
            <Field label="Art" htmlFor="sickness-type">
              <Select
                value={absenceType}
                onValueChange={(value) =>
                  setAbsenceType(value as SicknessAbsenceType)
                }
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

            <Field
              label="Ab"
              htmlFor="sickness-start-date"
              required
              error={dateErrors.start}
            >
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
              <Field
                label="Bis"
                htmlFor="sickness-end-date"
                required
                error={dateErrors.end}
              >
                <DatePicker
                  ariaLabel="Bis"
                  value={endDate ? new Date(`${endDate}T00:00:00`) : undefined}
                  onChange={(date) =>
                    setEndDate(date ? toLocalDateString(date) : '')
                  }
                  disabled={isSaving}
                />
              </Field>
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

            <ErrorText>{error}</ErrorText>
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
                <Button type="submit" disabled={isSaving}>
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
            <Field label="Letzter Tag" htmlFor="sickness-end-date-edit" required>
              <DatePicker
                ariaLabel="Letzter Tag"
                value={endDate ? new Date(`${endDate}T00:00:00`) : undefined}
                onChange={(date) =>
                  setEndDate(date ? toLocalDateString(date) : '')
                }
                disabled={isSaving}
              />
            </Field>
            <ErrorText>{error}</ErrorText>
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
        <ErrorText>{error}</ErrorText>
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
