'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Repeat2, Users } from 'lucide-react';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { DurationHoursInput } from '@/components/ui/duration-hours-input';
import { ErrorText } from '@/components/ui/error-text';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { SearchableMultiSelect } from '@/components/ui/searchable-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { TimeInput } from '@/components/ui/time-input';
import { parseHoursInputToMinutes } from '@/lib/jobs/planned-working';
import {
  createPlanningEntry,
  getPlanningOptions,
} from '@/lib/planning/actions';
import type { PlanningConflict } from '@/lib/planning/types';
import { parseDecimalInput } from '@/lib/ui/decimal';
import { toLocalDateString } from '@/lib/utils';

const WEEKDAYS = [
  ['Mo', 0],
  ['Di', 1],
  ['Mi', 2],
  ['Do', 3],
  ['Fr', 4],
  ['Sa', 5],
  ['So', 6],
] as const;

type Options = Extract<
  Awaited<ReturnType<typeof getPlanningOptions>>,
  { success: true }
>;

interface PlanningEntryFormProps {
  defaultDate?: Date;
  defaultTime?: string;
  defaultUserId?: string;
  onSuccess: () => void | Promise<void>;
}

function getMondayWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

function isoToLocalDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function PlanningEntryForm({
  defaultDate,
  defaultTime,
  defaultUserId,
  onSuccess,
}: PlanningEntryFormProps) {
  const initialDate = toLocalDateString(defaultDate ?? new Date());
  const { showBanner } = useBanner();
  const [options, setOptions] = useState<Options | null>(null);
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const requestSignatureRef = useRef('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [entryKind, setEntryKind] = useState<'job_visit' | 'internal'>('job_visit');
  const [jobId, setJobId] = useState('');
  const [internalType, setInternalType] = useState('meeting');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(defaultTime?.slice(0, 5) ?? '09:00');
  const [timeKind, setTimeKind] = useState<'timed' | 'all_day'>('timed');
  const [durationHours, setDurationHours] = useState('1');
  const [durationDays, setDurationDays] = useState('1');
  const [employeeRecordIds, setEmployeeRecordIds] = useState<string[]>([]);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [recurring, setRecurring] = useState(false);
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [interval, setIntervalValue] = useState('1');
  const [weekdays, setWeekdays] = useState<number[]>([
    getMondayWeekday(initialDate),
  ]);
  const [endMode, setEndMode] = useState<'count' | 'until'>('count');
  const [occurrenceCount, setOccurrenceCount] = useState('6');
  const [untilDate, setUntilDate] = useState('');
  const [conflicts, setConflicts] = useState<PlanningConflict[]>([]);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');

  useEffect(() => {
    let active = true;
    void getPlanningOptions()
      .then((result) => {
        if (!active) return;
        if (result.success) {
          setOptions(result);
          const matchingRecord = result.employees.find(
            (employee) => employee.userId === defaultUserId
          );
          if (matchingRecord) setEmployeeRecordIds([matchingRecord.employeeRecordId]);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [defaultUserId]);

  const employeeOptions = useMemo(
    () =>
      (options?.employees ?? []).map((employee) => ({
        value: employee.employeeRecordId,
        label:
          `${employee.firstName} ${employee.lastName}`.trim() ||
          employee.employeeNumber ||
          'Unbenannt',
        description: employee.userId ? undefined : 'Ohne App-Zugang',
      })),
    [options]
  );
  const jobOptions = useMemo(
    () =>
      (options?.jobs ?? []).map((job) => ({
        value: job.id,
        label: `${job.jobNumber ? `${job.jobNumber} · ` : ''}${job.title}`,
        description: job.projectName ?? undefined,
      })),
    [options]
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    const durationMinutes = parseHoursInputToMinutes(durationHours);
    const parsedDurationDays = parseDecimalInput(durationDays);
    const parsedInterval = parseDecimalInput(interval);
    const parsedOccurrenceCount = parseDecimalInput(occurrenceCount);
    if (
      (timeKind === 'timed' &&
        (durationMinutes === null ||
          durationMinutes < 15 ||
          durationMinutes > 168 * 60)) ||
      (timeKind === 'all_day' &&
        (!Number.isInteger(parsedDurationDays) ||
          parsedDurationDays < 1 ||
          parsedDurationDays > 31))
    ) {
      setSubmitError('Bitte eine gültige Dauer angeben.');
      return;
    }
    if (
      recurring &&
      (!Number.isInteger(parsedInterval) ||
        parsedInterval < 1 ||
        parsedInterval > 12 ||
        (endMode === 'count' &&
          (!Number.isInteger(parsedOccurrenceCount) ||
            parsedOccurrenceCount < 2 ||
            parsedOccurrenceCount > 730)))
    ) {
      setSubmitError('Bitte gültige Wiederholungswerte angeben.');
      return;
    }
    setSubmitting(true);
    const startsAtLocal = `${date}T${timeKind === 'timed' ? time : '00:00'}`;
    const request = {
      entryKind,
      internalType: entryKind === 'internal' ? internalType : null,
      jobId: entryKind === 'job_visit' ? jobId || null : null,
      title: entryKind === 'internal' ? title || null : null,
      description: entryKind === 'internal' ? description || null : null,
      location: entryKind === 'internal' ? location || null : null,
      timeKind,
      startsAtLocal,
      durationMinutes: timeKind === 'timed' ? durationMinutes : null,
      durationDays: timeKind === 'all_day' ? parsedDurationDays : null,
      assignmentDrafts: employeeRecordIds.map((employeeRecordId) => ({
        employeeRecordId,
        teamSourceId: null,
      })),
      teamIds,
      recurrence: recurring
        ? {
            frequency,
            interval: parsedInterval,
            weekdays: frequency === 'weekly' ? weekdays : null,
            monthDay: frequency === 'monthly' ? Number(date.slice(8, 10)) : null,
            occurrenceCount: endMode === 'count' ? parsedOccurrenceCount : null,
            untilLocalDate: endMode === 'until' ? untilDate || null : null,
          }
        : null,
    };
    const requestSignature = JSON.stringify(request);
    if (requestSignatureRef.current !== requestSignature) {
      requestSignatureRef.current = requestSignature;
      idempotencyKeyRef.current = crypto.randomUUID();
    }
    const payload = {
      ...request,
      idempotencyKey: idempotencyKeyRef.current,
      overrideReason: conflicts.length > 0 ? overrideReason || null : null,
      assessmentFingerprint: conflicts.length > 0 ? fingerprint : null,
    };
    try {
      const result = await createPlanningEntry(payload);
      if (result.success) {
        showBanner({
          variant: 'success',
          message:
            result.occurrenceIds.length === 1
              ? 'Termin wurde geplant.'
              : `${result.occurrenceIds.length} Termine wurden geplant.`,
        });
        await onSuccess();
        return;
      }
      if (
        (result.error === 'planning_warning' ||
          result.error === 'stale_assessment') &&
        result.conflicts &&
        result.fingerprint
      ) {
        setConflicts(result.conflicts);
        setFingerprint(result.fingerprint);
        if (result.error === 'stale_assessment') {
          showBanner({
            variant: 'info',
            message:
              'Die Planungslage hat sich geändert. Bitte Hinweise erneut prüfen.',
          });
        }
        return;
      }
      setSubmitError('Der Termin konnte nicht geplant werden.');
    } catch {
      setSubmitError('Der Termin konnte nicht geplant werden.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 pt-2" role="status" aria-busy="true">
        <span className="sr-only">Planungsdaten werden geladen …</span>
        <div aria-hidden="true" className="space-y-4">
          <Skeleton className="h-9 w-full" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      </div>
    );
  }
  if (!options) {
    return (
      <ErrorText className="py-8 text-center">
        Die Planungsdaten konnten nicht geladen werden.
      </ErrorText>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogBody className="space-y-5 pt-2">
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Art des geplanten Termins">
          <Button type="button" aria-pressed={entryKind === 'job_visit'} variant={entryKind === 'job_visit' ? 'secondary' : 'outline'} onClick={() => setEntryKind('job_visit')}>
            Auftragsbesuch
          </Button>
          <Button type="button" aria-pressed={entryKind === 'internal'} variant={entryKind === 'internal' ? 'secondary' : 'outline'} onClick={() => setEntryKind('internal')}>
            Interner Termin
          </Button>
        </div>

        {entryKind === 'job_visit' ? (
          <div className="space-y-2">
            <Label>Auftrag</Label>
            <SearchableMultiSelect
              options={jobOptions}
              selectedIds={jobId ? [jobId] : []}
              onSelectionChange={(ids) => setJobId(ids.at(-1) ?? '')}
              placeholder="Auftrag auswählen"
              selectedLabel={() => jobOptions.find((option) => option.value === jobId)?.label ?? 'Auftrag ausgewählt'}
              searchPlaceholder="Auftrag suchen …"
              emptyMessage="Kein Auftrag gefunden"
            />
            <p className="text-xs text-muted-foreground">Mehrere Besuche bleiben mit demselben Auftrag verbunden.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="planning-internal-type">Art</Label>
              <Select value={internalType} onValueChange={setInternalType}>
                <SelectTrigger id="planning-internal-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal_work">Interne Arbeit</SelectItem>
                  <SelectItem value="meeting">Besprechung</SelectItem>
                  <SelectItem value="training">Schulung</SelectItem>
                  <SelectItem value="other">Sonstiges</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="planning-title">Titel</Label>
              <Input id="planning-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="z. B. Teamrunde" />
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="planning-date">Datum</Label>
            <DatePicker
              id="planning-date"
              ariaLabel="Datum des Termins"
              value={isoToLocalDate(date)}
              onChange={(nextDate) => {
                const nextIso = nextDate ? toLocalDateString(nextDate) : '';
                setDate(nextIso);
                if (nextIso) setWeekdays([getMondayWeekday(nextIso)]);
                setConflicts([]);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="planning-time-kind">Zeitart</Label>
            <Select value={timeKind} onValueChange={(value) => setTimeKind(value as 'timed' | 'all_day')}>
              <SelectTrigger id="planning-time-kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="timed">Mit Uhrzeit</SelectItem>
                <SelectItem value="all_day">Ganztägig / mehrtägig</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {timeKind === 'timed' ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="planning-time">Beginn</Label>
                <TimeInput id="planning-time" value={time} onChange={setTime} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="planning-duration">Dauer</Label>
                <DurationHoursInput id="planning-duration" value={durationHours} onChange={setDurationHours} />
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="planning-days">Kalendertage</Label>
              <QuantityStepper id="planning-days" min={1} value={durationDays} onChange={setDurationDays} />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>Mitarbeiter</Label>
          <SearchableMultiSelect
            options={employeeOptions}
            selectedIds={employeeRecordIds}
            onSelectionChange={(ids) => { setEmployeeRecordIds(ids); setConflicts([]); }}
            placeholder="Mitarbeiter zuweisen"
            selectedLabel={(count) => count === 1 ? '1 Mitarbeiter' : `${count} Mitarbeiter`}
            searchPlaceholder="Mitarbeiter suchen …"
            emptyMessage="Kein Mitarbeiter gefunden"
          />
          {options.teams.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Teams für die Planung auswählen">
              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="size-3.5" /> Teams:</span>
              {options.teams.map((team) => (
                <Button key={team.id} type="button" size="sm" aria-pressed={teamIds.includes(team.id)} variant={teamIds.includes(team.id) ? 'secondary' : 'outline'} className="h-7" onClick={() => { setTeamIds((ids) => ids.includes(team.id) ? ids.filter((id) => id !== team.id) : [...ids, team.id]); setConflicts([]); }}>
                  {team.name}
                </Button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3 border-t pt-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <Checkbox checked={recurring} onCheckedChange={(checked) => setRecurring(checked === true)} />
            <Repeat2 className="size-4 text-muted-foreground" /> Wiederholen
          </label>
          {recurring && (
            <div className="space-y-4 rounded-lg border bg-muted/20 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2"><Label>Rhythmus</Label><Select value={frequency} onValueChange={(value) => setFrequency(value as typeof frequency)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">Täglich</SelectItem><SelectItem value="weekly">Wöchentlich</SelectItem><SelectItem value="monthly">Monatlich</SelectItem></SelectContent></Select></div>
                <div className="space-y-2">
                  <Label htmlFor="planning-interval">Alle</Label>
                  <div className="flex items-center gap-2">
                    <QuantityStepper id="planning-interval" min={1} className="flex-1" value={interval} onChange={setIntervalValue} />
                    <span className="text-sm text-muted-foreground">{frequency === 'daily' ? 'Tage' : frequency === 'weekly' ? 'Wochen' : 'Monate'}</span>
                  </div>
                </div>
              </div>
              {frequency === 'weekly' && (
                <div className="space-y-2"><Label>Wochentage</Label><div className="flex flex-wrap gap-1.5">{WEEKDAYS.map(([label, value]) => <Button key={value} type="button" size="sm" variant={weekdays.includes(value) ? 'secondary' : 'outline'} className="size-8 p-0" aria-pressed={weekdays.includes(value)} onClick={() => setWeekdays((days) => days.includes(value) ? days.filter((day) => day !== value) : [...days, value].sort())}>{label}</Button>)}</div></div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2"><Label>Ende</Label><Select value={endMode} onValueChange={(value) => setEndMode(value as typeof endMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="count">Nach Anzahl</SelectItem><SelectItem value="until">An Datum</SelectItem></SelectContent></Select></div>
                {endMode === 'count' ? (
                  <div className="space-y-2">
                    <Label htmlFor="planning-count">Termine</Label>
                    <QuantityStepper id="planning-count" min={2} value={occurrenceCount} onChange={setOccurrenceCount} />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="planning-until">Letztes Datum</Label>
                    <DatePicker
                      id="planning-until"
                      ariaLabel="Letztes Datum der Serie"
                      value={isoToLocalDate(untilDate)}
                      onChange={(nextDate) => setUntilDate(nextDate ? toLocalDateString(nextDate) : '')}
                    />
                  </div>
                )}
              </div>
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><CalendarDays className="mt-0.5 size-3.5 shrink-0" />WerkFlow plant höchstens 18 Monate im Voraus und erweitert die Serie später ohne Duplikate.</p>
            </div>
          )}
        </div>

        {entryKind === 'internal' && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Weitere Angaben</summary>
            <div className="mt-3 grid gap-3">
              <div className="space-y-2">
                <Label htmlFor="planning-location">Ort</Label>
                <Input
                  id="planning-location"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="planning-description">Beschreibung</Label>
                <Textarea
                  id="planning-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
            </div>
          </details>
        )}

        {conflicts.length > 0 && (
          <div data-planning-warning className="space-y-3 rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-3" role="alert">
            <div><p className="font-medium">Planungshinweise prüfen</p><p className="text-xs text-muted-foreground">Die Hinweise blockieren berechtigte Ausnahmen nicht. Eine bewusste Abweichung benötigt einen Grund.</p></div>
            <ul className="space-y-1.5 text-sm">{conflicts.map((conflict, index) => <li key={`${conflict.kind}-${conflict.employeeRecordId}-${conflict.localDate}-${index}`} className="flex gap-2"><span aria-hidden="true">•</span><span>{conflict.employeeName ? `${conflict.employeeName}: ` : ''}{conflict.message}{conflict.localDate ? ` (${conflict.localDate})` : ''}</span></li>)}</ul>
            <div className="space-y-2"><Label htmlFor="planning-override">Begründung der Abweichung</Label><Textarea id="planning-override" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Warum ist diese Planung trotzdem sinnvoll?" /></div>
          </div>
        )}

        <ErrorText>{submitError}</ErrorText>
      </DialogBody>

      <DialogFooter className="pt-4">
        <Button
          type="submit"
          className="w-full"
          disabled={
            submitting ||
            !date ||
            (entryKind === 'job_visit' ? !jobId : !title.trim()) ||
            (conflicts.length > 0 && overrideReason.trim().length < 8)
          }
        >
          {submitting ? 'Planung wird geprüft …' : conflicts.length > 0 ? 'Mit Begründung planen' : 'Planung prüfen und speichern'}
        </Button>
      </DialogFooter>
    </form>
  );
}
