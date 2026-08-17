'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Repeat2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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
import type { CalendarJob } from '@/lib/jobs/types';
import {
  extendPlanningSeriesHorizon,
  getPlanningOptions,
  reschedulePlanningSeries,
  setPlanningOccurrenceStatus,
  updatePlanningCalendarEntry,
} from '@/lib/planning/actions';
import type { PlanningConflict } from '@/lib/planning/types';

interface PlanningOccurrenceEditDialogProps {
  job: CalendarJob;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function PlanningOccurrenceEditDialog({
  job,
  open,
  onOpenChange,
  onSuccess,
}: PlanningOccurrenceEditDialogProps) {
  const assignedEmployeeRecordKey = (
    job.assignedEmployeeRecordIds ?? []
  ).join(',');
  const [date, setDate] = useState(job.plannedDate ?? '');
  const [time, setTime] = useState(job.plannedTime ?? '09:00');
  const [durationHours, setDurationHours] = useState(
    String((job.estimatedDurationMinutes ?? 60) / 60)
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
  const [statusIntent, setStatusIntent] = useState<
    'skipped' | 'cancelled' | null
  >(null);
  const [extending, setExtending] = useState(false);
  const [extendConflicts, setExtendConflicts] = useState<PlanningConflict[]>([]);
  const [extendFingerprint, setExtendFingerprint] = useState<string | null>(
    null
  );
  const [extendReason, setExtendReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setDate(job.plannedDate ?? '');
    setTime(job.plannedTime ?? '09:00');
    setDurationHours(String((job.estimatedDurationMinutes ?? 60) / 60));
    setScope('one');
    setEmployeeRecordIds(
      assignedEmployeeRecordKey ? assignedEmployeeRecordKey.split(',') : []
    );
    setConflicts([]);
    setFingerprint(null);
    setReason('');
    setStatusIntent(null);
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
        toast.error('Die Mitarbeiterliste konnte nicht geladen werden.');
      })
      .catch(() => {
        if (!active) return;
        setOptionsFailed(true);
        toast.error('Die Mitarbeiterliste konnte nicht geladen werden.');
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

  async function handleSubmit() {
    if (!job.occurrenceId) return;
    const parsedDurationHours = Number(durationHours);
    if (
      job.timeKind !== 'all_day' &&
      (!Number.isFinite(parsedDurationHours) ||
        parsedDurationHours < 0.25 ||
        parsedDurationHours > 168)
    ) {
      toast.error('Bitte eine gültige Dauer angeben.');
      return;
    }
    setSubmitting(true);
    const input = {
      plannedDate: date,
      plannedTime: job.timeKind === 'all_day' ? undefined : time,
      estimatedDurationMinutes:
        job.timeKind === 'all_day'
          ? undefined
          : Math.round(parsedDurationHours * 60),
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
        toast.success(
          scope === 'one'
            ? 'Termin wurde angepasst.'
            : scope === 'future'
              ? 'Dieser und zukünftige Termine wurden angepasst.'
              : 'Alle noch änderbaren Serientermine wurden angepasst.'
        );
        onOpenChange(false);
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
          toast.info('Die Planungslage hat sich geändert. Bitte erneut prüfen.');
        }
        return;
      }
      toast.error(
        result.error === 'started_occurrence' ||
          result.error === 'no_mutable_occurrences'
          ? 'Begonnene oder vergangene Termine bleiben unverändert.'
          : 'Die Änderung konnte nicht gespeichert werden.'
      );
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
          toast.info('Die Serie ist bereits bis zu ihrem Ende geplant.');
          return;
        }
        toast.success(
          `Serie wurde um sechs Monate verlängert (${result.occurrenceIds.length} neue Termine).`
        );
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
          toast.info('Die Planungslage hat sich geändert. Bitte erneut prüfen.');
        }
        return;
      }
      toast.error(
        result.error === 'stale_series'
          ? 'Die Serie wurde zwischenzeitlich geändert. Bitte den Termin neu öffnen.'
          : 'Die Serie konnte nicht verlängert werden.'
      );
    } finally {
      setExtending(false);
    }
  }

  async function handleStatusChange() {
    if (!job.occurrenceId || !statusIntent || reason.trim().length < 8) return;
    setSubmitting(true);
    try {
      const result = await setPlanningOccurrenceStatus(
        job.occurrenceId,
        statusIntent,
        reason
      );
      if (!result.success) {
        toast.error('Der Terminstatus konnte nicht geändert werden.');
        return;
      }
      toast.success(
        statusIntent === 'skipped'
          ? 'Termin wurde ausgelassen.'
          : 'Termin wurde abgesagt.'
      );
      onOpenChange(false);
      onSuccess?.();
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
        <div className="space-y-4">
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
              <Input
                id="planning-edit-date"
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setConflicts([]);
                }}
              />
            </div>
            {job.timeKind !== 'all_day' && (
              <div className="space-y-2">
                <Label htmlFor="planning-edit-time">Beginn</Label>
                <Input
                  id="planning-edit-time"
                  type="time"
                  value={time}
                  onChange={(event) => {
                    setTime(event.target.value);
                    setConflicts([]);
                  }}
                />
              </div>
            )}
          </div>
          {job.timeKind !== 'all_day' && (
            <div className="space-y-2">
              <Label htmlFor="planning-edit-duration">Dauer in Stunden</Label>
              <Input
                id="planning-edit-duration"
                type="number"
                min="0.25"
                max="168"
                step="0.25"
                value={durationHours}
                onChange={(event) => {
                  setDurationHours(event.target.value);
                  setConflicts([]);
                }}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>Mitarbeiter</Label>
            {optionsFailed && (
              <p role="alert" className="text-sm text-destructive">
                Die Mitarbeiterliste konnte nicht geladen werden.
              </p>
            )}
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
        </div>
        <DialogFooter>
          <div className="mr-auto flex gap-2">
            {job.seriesId && (
              <Button
                variant="outline"
                onClick={() => {
                  setStatusIntent('skipped');
                  setReason('');
                  setConflicts([]);
                }}
              >
                Auslassen
              </Button>
            )}
            <Button
              variant="destructive"
              onClick={() => {
                setStatusIntent('cancelled');
                setReason('');
                setConflicts([]);
              }}
            >
              Termin absagen
            </Button>
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Schließen
          </Button>
          <Button
            disabled={
              submitting ||
              optionsFailed ||
              !date ||
              (job.timeKind !== 'all_day' &&
                (!Number.isFinite(Number(durationHours)) ||
                  Number(durationHours) < 0.25 ||
                  Number(durationHours) > 168)) ||
              (statusIntent !== null && reason.trim().length < 8) ||
              (conflicts.length > 0 && reason.trim().length < 8)
            }
            onClick={() =>
              void (statusIntent ? handleStatusChange() : handleSubmit())
            }
          >
            {submitting
              ? 'Wird geprüft …'
              : statusIntent
                ? 'Status speichern'
                : 'Änderung speichern'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
