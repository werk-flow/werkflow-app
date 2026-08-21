'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Repeat2 } from 'lucide-react';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
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
import { DurationHoursInput } from '@/components/ui/duration-hours-input';
import { ErrorText } from '@/components/ui/error-text';
import { Label } from '@/components/ui/label';
import { SearchableMultiSelect } from '@/components/ui/searchable-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { TimeInput } from '@/components/ui/time-input';
import {
  formatMinutesAsHoursInput,
  parseHoursInputToMinutes,
} from '@/lib/jobs/planned-working';
import type { CalendarJob } from '@/lib/jobs/types';
import {
  extendPlanningSeriesHorizon,
  getPlanningOptions,
  reschedulePlanningSeries,
  setPlanningOccurrenceStatus,
  updatePlanningCalendarEntry,
} from '@/lib/planning/actions';
import type { PlanningConflict } from '@/lib/planning/types';
import { toLocalDateString } from '@/lib/utils';

interface PlanningOccurrenceEditDialogProps {
  job: CalendarJob;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

function isoToLocalDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function PlanningOccurrenceEditDialog({
  job,
  open,
  onOpenChange,
  onSuccess,
}: PlanningOccurrenceEditDialogProps) {
  const { showBanner } = useBanner();
  const assignedEmployeeRecordKey = (
    job.assignedEmployeeRecordIds ?? []
  ).join(',');
  const [date, setDate] = useState(job.plannedDate ?? '');
  const [time, setTime] = useState(job.plannedTime ?? '09:00');
  const [durationHours, setDurationHours] = useState(
    formatMinutesAsHoursInput(job.estimatedDurationMinutes ?? 60)
  );
  const [scope, setScope] = useState<'one' | 'future' | 'series'>('one');
  const [employeeRecordIds, setEmployeeRecordIds] = useState(
    job.assignedEmployeeRecordIds ?? []
  );
  const [employees, setEmployees] = useState<
    Array<{
      employeeRecordId: string;
      firstName: string;
      lastName: string;
      employeeNumber: string | null;
      userId: string | null;
    }>
  >([]);
  const [optionsFailed, setOptionsFailed] = useState(false);
  const [conflicts, setConflicts] = useState<PlanningConflict[]>([]);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [statusIntent, setStatusIntent] = useState<
    'skipped' | 'cancelled' | null
  >(null);
  const [extending, setExtending] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [extendConflicts, setExtendConflicts] = useState<PlanningConflict[]>([]);
  const [extendFingerprint, setExtendFingerprint] = useState<string | null>(
    null
  );
  const [extendReason, setExtendReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setDate(job.plannedDate ?? '');
    setTime(job.plannedTime ?? '09:00');
    setDurationHours(
      formatMinutesAsHoursInput(job.estimatedDurationMinutes ?? 60)
    );
    setScope('one');
    setEmployeeRecordIds(
      assignedEmployeeRecordKey ? assignedEmployeeRecordKey.split(',') : []
    );
    setConflicts([]);
    setFingerprint(null);
    setReason('');
    setSubmitError(null);
    setStatusIntent(null);
    setExtendError(null);
    setExtendConflicts([]);
    setExtendFingerprint(null);
    setExtendReason('');
    setOptionsFailed(false);
    let active = true;
    void getPlanningOptions()
      .then((result) => {
        if (!active) return;
        if (result.success) {
          setEmployees(result.employees);
          return;
        }
        setOptionsFailed(true);
      })
      .catch(() => {
        if (!active) return;
        setOptionsFailed(true);
      });
    return () => {
      active = false;
    };
  }, [
    assignedEmployeeRecordKey,
    job.estimatedDurationMinutes,
    job.occurrenceId,
    job.plannedDate,
    job.plannedTime,
    open,
  ]);

  const employeeOptions = useMemo(
    () =>
      employees.map((employee) => ({
        value: employee.employeeRecordId,
        label:
          `${employee.firstName} ${employee.lastName}`.trim() ||
          employee.employeeNumber ||
          'Unbenannt',
        description: employee.userId ? undefined : 'Ohne App-Zugang',
      })),
    [employees]
  );

  const durationMinutes = parseHoursInputToMinutes(durationHours);
  const durationInvalid =
    job.timeKind !== 'all_day' &&
    (durationMinutes === null ||
      durationMinutes < 15 ||
      durationMinutes > 168 * 60);

  async function handleSubmit() {
    if (!job.occurrenceId) return;
    if (durationInvalid) {
      setSubmitError('Bitte eine gültige Dauer angeben.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const input = {
      plannedDate: date,
      plannedTime: job.timeKind === 'all_day' ? undefined : time,
      estimatedDurationMinutes:
        job.timeKind === 'all_day' ? undefined : durationMinutes ?? undefined,
      selectedEmployeeRecordIds: employeeRecordIds,
      overrideReason: conflicts.length ? reason || null : null,
      assessmentFingerprint: conflicts.length ? fingerprint : null,
    };
    try {
      const result =
        scope === 'one'
          ? await updatePlanningCalendarEntry(job.occurrenceId, input)
          : await reschedulePlanningSeries(job.occurrenceId, scope, input);
      if (result.success) {
        onOpenChange(false);
        showBanner({
          variant: 'success',
          message:
            scope === 'one'
              ? 'Termin wurde angepasst.'
              : scope === 'future'
                ? 'Dieser und zukünftige Termine wurden angepasst.'
                : 'Alle noch änderbaren Serientermine wurden angepasst.',
        });
        onSuccess?.();
        return;
      }
      if (
        (result.error === 'planning_warning' ||
          result.error === 'stale_assessment') &&
        'conflicts' in result &&
        'fingerprint' in result &&
        Array.isArray(result.conflicts) &&
        typeof result.fingerprint === 'string'
      ) {
        setConflicts(result.conflicts as PlanningConflict[]);
        setFingerprint(result.fingerprint);
        if (result.error === 'stale_assessment') {
          showBanner({
            variant: 'info',
            message: 'Die Planungslage hat sich geändert. Bitte erneut prüfen.',
          });
        }
        return;
      }
      setSubmitError(
        result.error === 'started_occurrence' ||
          result.error === 'no_mutable_occurrences'
          ? 'Begonnene oder vergangene Termine bleiben unverändert.'
          : 'Die Änderung konnte nicht gespeichert werden.'
      );
    } catch {
      setSubmitError('Die Änderung konnte nicht gespeichert werden.');
    } finally {
      setSubmitting(false);
    }
  }

  // P1-11-F02: one click extends the series horizon by six months at a time.
  // The extension re-checks capacity/qualification like any other planning and
  // demands a fresh decision when the facts changed since the shown warning.
  async function handleExtendSeries() {
    if (!job.seriesId) return;
    if (extendConflicts.length > 0 && extendReason.trim().length < 8) return;
    setExtending(true);
    setExtendError(null);
    try {
      const result = await extendPlanningSeriesHorizon(
        job.seriesId,
        extendConflicts.length > 0
          ? {
              assessmentFingerprint: extendFingerprint,
              overrideReason: extendReason.trim(),
            }
          : undefined
      );
      if (result.success) {
        if (result.occurrenceIds.length === 0) {
          showBanner({
            variant: 'info',
            message: 'Die Serie ist bereits bis zu ihrem Ende geplant.',
          });
          return;
        }
        showBanner({
          variant: 'success',
          message: `Serie wurde um sechs Monate verlängert (${result.occurrenceIds.length} neue Termine).`,
        });
        setExtendConflicts([]);
        setExtendFingerprint(null);
        setExtendReason('');
        onSuccess?.();
        return;
      }
      if (
        (result.error === 'planning_warning' ||
          result.error === 'stale_assessment') &&
        result.conflicts &&
        result.fingerprint
      ) {
        setExtendConflicts(result.conflicts);
        setExtendFingerprint(result.fingerprint);
        if (result.error === 'stale_assessment') {
          showBanner({
            variant: 'info',
            message: 'Die Planungslage hat sich geändert. Bitte erneut prüfen.',
          });
        }
        return;
      }
      setExtendError(
        result.error === 'stale_series'
          ? 'Die Serie wurde zwischenzeitlich geändert. Bitte den Termin neu öffnen.'
          : 'Die Serie konnte nicht verlängert werden.'
      );
    } catch {
      setExtendError('Die Serie konnte nicht verlängert werden.');
    } finally {
      setExtending(false);
    }
  }

  async function handleStatusChange() {
    if (!job.occurrenceId || !statusIntent || reason.trim().length < 8) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await setPlanningOccurrenceStatus(
        job.occurrenceId,
        statusIntent,
        reason
      );
      if (!result.success) {
        setSubmitError('Der Terminstatus konnte nicht geändert werden.');
        return;
      }
      onOpenChange(false);
      showBanner({
        variant: 'success',
        message:
          statusIntent === 'skipped'
            ? 'Termin wurde ausgelassen.'
            : 'Termin wurde abgesagt.',
      });
      onSuccess?.();
    } catch {
      setSubmitError('Der Terminstatus konnte nicht geändert werden.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Geplanten Termin bearbeiten</DialogTitle>
          <DialogDescription>
            Die Planung ändert keine bereits erfasste Arbeitszeit.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void (statusIntent ? handleStatusChange() : handleSubmit());
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogBody className="space-y-4">
            {job.seriesId && (
              <div className="space-y-2">
                <Label htmlFor="planning-edit-scope">Änderungsumfang</Label>
                <Select
                  value={scope}
                  onValueChange={(value) => {
                    setScope(value as typeof scope);
                    setConflicts([]);
                  }}
                >
                  <SelectTrigger id="planning-edit-scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one">Nur dieser Termin</SelectItem>
                    <SelectItem value="future">Dieser und zukünftige</SelectItem>
                    <SelectItem value="series">Ganze Serie ab frühestem änderbaren Termin</SelectItem>
                  </SelectContent>
                </Select>
                {scope !== 'one' && (
                  <p className="flex gap-1.5 text-xs text-muted-foreground">
                    <Repeat2 className="mt-0.5 size-3.5 shrink-0" />
                    Vergangene, begonnene und einzeln angepasste Termine bleiben
                    erhalten. „Dieser und zukünftige“ erzeugt einen
                    nachvollziehbaren Serienabschnitt.
                  </p>
                )}
                <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      Die Serie ist zunächst 18 Monate im Voraus geplant.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        extending ||
                        (extendConflicts.length > 0 &&
                          extendReason.trim().length < 8)
                      }
                      onClick={() => void handleExtendSeries()}
                    >
                      {extending
                        ? 'Wird verlängert …'
                        : extendConflicts.length > 0
                          ? 'Mit Begründung verlängern'
                          : 'Serie um sechs Monate verlängern'}
                    </Button>
                  </div>
                  <ErrorText>{extendError}</ErrorText>
                  {extendConflicts.length > 0 && (
                    <div
                      data-planning-warning
                      role="alert"
                      className="space-y-2 rounded-md border border-yellow-500/40 bg-yellow-500/5 p-2.5"
                    >
                      <p className="text-sm font-medium">Planungshinweise</p>
                      <ul className="space-y-1 text-sm">
                        {extendConflicts.map((conflict, index) => (
                          <li key={`extend-${conflict.kind}-${index}`}>
                            •{' '}
                            {conflict.employeeName
                              ? `${conflict.employeeName}: `
                              : ''}
                            {conflict.message}
                            {conflict.localDate ? ` (${conflict.localDate})` : ''}
                          </li>
                        ))}
                      </ul>
                      <div className="space-y-2">
                        <Label htmlFor="planning-extend-reason">Begründung</Label>
                        <Textarea
                          id="planning-extend-reason"
                          value={extendReason}
                          onChange={(event) => setExtendReason(event.target.value)}
                          placeholder="Warum ist die Verlängerung trotzdem sinnvoll?"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="planning-edit-date">Datum</Label>
                <DatePicker
                  id="planning-edit-date"
                  ariaLabel="Datum des Termins"
                  value={isoToLocalDate(date)}
                  onChange={(nextDate) => {
                    setDate(nextDate ? toLocalDateString(nextDate) : '');
                    setConflicts([]);
                  }}
                />
              </div>
              {job.timeKind !== 'all_day' && (
                <div className="space-y-2">
                  <Label htmlFor="planning-edit-time">Beginn</Label>
                  <TimeInput
                    id="planning-edit-time"
                    value={time}
                    onChange={(nextTime) => {
                      setTime(nextTime);
                      setConflicts([]);
                    }}
                  />
                </div>
              )}
            </div>
            {job.timeKind !== 'all_day' && (
              <div className="space-y-2">
                <Label htmlFor="planning-edit-duration">Dauer</Label>
                <DurationHoursInput
                  id="planning-edit-duration"
                  value={durationHours}
                  onChange={(nextValue) => {
                    setDurationHours(nextValue);
                    setConflicts([]);
                  }}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Mitarbeiter</Label>
              <ErrorText>
                {optionsFailed
                  ? 'Die Mitarbeiterliste konnte nicht geladen werden.'
                  : null}
              </ErrorText>
              <SearchableMultiSelect
                options={employeeOptions}
                selectedIds={employeeRecordIds}
                onSelectionChange={(ids) => {
                  setEmployeeRecordIds(ids);
                  setConflicts([]);
                }}
                placeholder="Mitarbeiter zuweisen"
                selectedLabel={(count) =>
                  count === 1 ? '1 Mitarbeiter' : `${count} Mitarbeiter`
                }
                searchPlaceholder="Mitarbeiter suchen …"
                emptyMessage="Kein Mitarbeiter gefunden"
              />
            </div>
            {conflicts.length > 0 && (
              <div data-planning-warning role="alert" className="space-y-3 rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-3">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="size-4 text-yellow-600 dark:text-yellow-400" />
                  Planungshinweise
                </p>
                <ul className="space-y-1 text-sm">
                  {conflicts.map((conflict, index) => (
                    <li key={`${conflict.kind}-${index}`}>
                      • {conflict.employeeName ? `${conflict.employeeName}: ` : ''}
                      {conflict.message}
                      {conflict.localDate ? ` (${conflict.localDate})` : ''}
                    </li>
                  ))}
                </ul>
                <div className="space-y-2">
                  <Label htmlFor="planning-edit-reason">Begründung</Label>
                  <Textarea
                    id="planning-edit-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Warum ist die Änderung trotzdem sinnvoll?"
                  />
                </div>
              </div>
            )}
            {statusIntent && (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">
                    {statusIntent === 'skipped'
                      ? 'Diesen Termin auslassen'
                      : 'Diesen Termin absagen'}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setStatusIntent(null);
                      setReason('');
                      setSubmitError(null);
                    }}
                  >
                    Zurück zum Bearbeiten
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Der Termin bleibt für Verlauf und Nachvollziehbarkeit erhalten
                  und wird nicht gelöscht.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="planning-status-reason">Begründung</Label>
                  <Textarea
                    id="planning-status-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Kurze nachvollziehbare Begründung"
                  />
                </div>
              </div>
            )}
            <ErrorText>{submitError}</ErrorText>
          </DialogBody>
          <DialogFooter className="pt-4">
            <div className="mr-auto flex gap-2">
              {job.seriesId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setStatusIntent('skipped');
                    setReason('');
                    setConflicts([]);
                    setSubmitError(null);
                  }}
                >
                  Auslassen
                </Button>
              )}
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setStatusIntent('cancelled');
                  setReason('');
                  setConflicts([]);
                  setSubmitError(null);
                }}
              >
                Termin absagen
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Schließen
            </Button>
            <Button
              type="submit"
              disabled={
                submitting ||
                // Status changes (auslassen/absagen) only need their reason;
                // the schedule-edit validations must not block them.
                (statusIntent !== null
                  ? reason.trim().length < 8
                  : optionsFailed ||
                    !date ||
                    durationInvalid ||
                    (conflicts.length > 0 && reason.trim().length < 8))
              }
            >
              {submitting
                ? 'Wird geprüft …'
                : statusIntent
                  ? 'Status speichern'
                  : 'Änderung speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
