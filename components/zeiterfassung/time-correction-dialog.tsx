'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DateTimeField } from '@/components/ui/date-time-field';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useBanner } from '@/components/ui/banner';
import {
  getTimeCorrectionFormOptions,
  submitTimeCorrection,
  type TimeCorrectionFormOptions,
} from '@/lib/time-corrections/actions';
import {
  TIME_CORRECTION_KIND_LABELS,
  type TimeCorrectionKind,
} from '@/lib/time-corrections/types';
import type { TimeEntry, TimeSegmentKind } from '@/lib/time-tracking/types';

type CorrectionDialogProps = {
  organizationId: string;
  entry?: TimeEntry;
  onSubmitted?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
};

const SOURCE_KINDS: TimeCorrectionKind[] = [
  'edit',
  'delete',
  'split',
  'reclassify',
  'reallocate',
  'reassign',
];

const ACTIVITY_OPTIONS: Array<{ value: TimeSegmentKind; label: string }> = [
  { value: 'work', label: 'Arbeit' },
  { value: 'travel', label: 'Fahrt' },
  { value: 'break', label: 'Pause' },
  { value: 'standby', label: 'Bereitschaft' },
  { value: 'callout', label: 'Notdienst' },
  { value: 'internal_activity', label: 'Interne Tätigkeit' },
];

function toLocalDateTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function oneHourAfter(value: string): string {
  const date = new Date(value || Date.now());
  date.setHours(date.getHours() + 1);
  return toLocalDateTime(date.toISOString());
}

const CORRECTION_ERROR_MESSAGES: Record<string, string> = {
  invalid_input: 'Bitte prüfe die Angaben.',
  invalid_shape: 'Die gewählte Korrektur ist unvollständig.',
  invalid_time_order: 'Die Endzeit muss nach der Startzeit liegen.',
  source_required: 'Für diese Korrektur fehlt der ursprüngliche Eintrag.',
  source_not_found: 'Der ursprüngliche Eintrag hat sich geändert. Bitte lade neu.',
  not_responsible: 'Du darfst die Zeit dieser Person nicht direkt korrigieren.',
  self_approval_not_allowed: 'Eigene Korrekturen müssen von einer zweiten Person freigegeben werden.',
  request_failed: 'Die Korrektur konnte nicht gespeichert werden.',
};

export function TimeCorrectionDialog({
  organizationId,
  entry,
  onSubmitted,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: CorrectionDialogProps) {
  const { showBanner } = useBanner();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback((nextOpen: boolean) => {
    setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [onOpenChange]);
  const [loadedOptions, setLoadedOptions] = useState<{
    organizationId: string;
    value: TimeCorrectionFormOptions;
  } | null>(null);
  const options = loadedOptions?.organizationId === organizationId
    ? loadedOptions.value
    : null;
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [kind, setKind] = useState<TimeCorrectionKind>(entry ? 'edit' : 'missed_clock');
  const initialStart = toLocalDateTime(entry?.timestamp ?? new Date().toISOString());
  const [startAt, setStartAt] = useState(initialStart);
  const [splitAt, setSplitAt] = useState(oneHourAfter(initialStart));
  const [endAt, setEndAt] = useState(oneHourAfter(initialStart));
  const [reason, setReason] = useState('');
  const [subjectEmployeeRecordId, setSubjectEmployeeRecordId] = useState('');
  const [targetEmployeeRecordId, setTargetEmployeeRecordId] = useState('');
  const [jobId, setJobId] = useState(entry?.jobId ?? 'none');
  const [activityKind, setActivityKind] = useState<TimeSegmentKind>(
    entry?.activityKind ?? 'work'
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingOptions(true);
    setLoadedOptions(null);
    setSubjectEmployeeRecordId('');
    setTargetEmployeeRecordId('');
    setJobId(entry?.jobId ?? 'none');

    void getTimeCorrectionFormOptions(organizationId)
      .then((result) => {
        if (cancelled) return;
        if (!result.success) {
          showBanner({
            variant: 'error',
            message: 'Die Korrekturmaske konnte nicht geladen werden.',
          });
          setOpen(false);
          return;
        }
        setLoadedOptions({ organizationId, value: result.options });
        const sourcePerson = entry
          ? result.options.people.find((person) => person.userId === entry.userId)
          : null;
        const subjectId = sourcePerson?.employeeRecordId
          ?? result.options.currentEmployeeRecordId;
        setSubjectEmployeeRecordId(subjectId);
        setTargetEmployeeRecordId(subjectId);
      })
      .catch(() => {
        if (cancelled) return;
        showBanner({
          variant: 'error',
          message: 'Die Korrekturmaske konnte nicht geladen werden.',
        });
        setOpen(false);
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [entry, open, organizationId, setOpen, showBanner]);

  const source = useMemo(() => {
    if (!entry?.sourceKind) return null;
    const id = entry.sourceKind === 'canonical_segment'
      ? entry.canonicalSegmentId
      : entry.sourceKind === 'correction_application'
        ? entry.correctionApplicationId
        : entry.id;
    return id ? { kind: entry.sourceKind, id } : null;
  }, [entry]);

  const submit = async () => {
    if (!subjectEmployeeRecordId) {
      showBanner({ variant: 'error', message: 'Bitte wähle eine Person aus.' });
      return;
    }
    if (!reason.trim()) {
      showBanner({ variant: 'error', message: 'Bitte gib einen Grund an.' });
      return;
    }
    const baseEmployeeRecordId = kind === 'reassign'
      ? targetEmployeeRecordId
      : subjectEmployeeRecordId;
    const makeFact = (
      factId: string,
      entryType: TimeEntry['entryType'],
      localValue: string
    ) => ({
      factId,
      employeeRecordId: baseEmployeeRecordId,
      entryType,
      timestamp: new Date(localValue).toISOString(),
      jobId: jobId === 'none' ? null : jobId,
      activityKind,
    });
    let proposedFacts: ReturnType<typeof makeFact>[] = [];
    if (kind === 'add' || kind === 'missed_clock') {
      proposedFacts = [
        makeFact('start', 'clock_in', startAt),
        makeFact('end', 'clock_out', endAt),
      ];
    } else if (kind === 'split') {
      proposedFacts = [
        makeFact('first-start', 'clock_in', startAt),
        makeFact('first-end', 'clock_out', splitAt),
        makeFact('second-start', 'clock_in', splitAt),
        makeFact('second-end', 'clock_out', endAt),
      ];
    } else if (kind !== 'delete' && entry) {
      proposedFacts = [makeFact('changed', entry.entryType, startAt)];
    }

    setSubmitting(true);
    try {
      const result = await submitTimeCorrection({
        organizationId,
        subjectEmployeeRecordId,
        kind,
        reason,
        source: kind === 'add' || kind === 'missed_clock' ? null : source,
        proposedFacts,
        operationId: crypto.randomUUID(),
      });
      if (!result.success) {
        showBanner({
          variant: 'error',
          message: CORRECTION_ERROR_MESSAGES[result.error]
            ?? 'Die Korrektur konnte nicht gespeichert werden.',
        });
        return;
      }
      showBanner({
        variant: 'success',
        message: result.status === 'approved'
          ? 'Die Zeit wurde korrigiert.'
          : 'Die Korrektur wurde zur Prüfung eingereicht.',
      });
      setOpen(false);
      setReason('');
      onSubmitted?.();
    } catch {
      showBanner({
        variant: 'error',
        message: 'Die Korrektur konnte nicht gespeichert werden.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const peopleOptions = options?.people.map((person) => ({
    value: person.employeeRecordId,
    label: person.name,
  })) ?? [];
  const jobOptions = [
    { value: 'none', label: 'Ohne Auftrag' },
    ...(options?.jobs.map((job) => ({ value: job.id, label: job.label })) ?? []),
  ];
  const sourceKinds = entry ? SOURCE_KINDS : ['add', 'missed_clock'] as TimeCorrectionKind[];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger ? <DialogTrigger asChild>
        <Button variant={entry ? 'ghost' : 'outline'} size="sm">
          {entry ? <Pencil className="mr-1.5 size-4" /> : <Plus className="mr-1.5 size-4" />}
          {entry ? 'Korrigieren' : 'Zeit nachtragen'}
        </Button>
      </DialogTrigger> : null}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Zeitkorrektur</DialogTitle>
          <DialogDescription>
            Eigene Änderungen gehen zur Prüfung. Freigabeberechtigte können Zeiten anderer Personen direkt korrigieren.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {loadingOptions || !options ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Daten werden geladen …
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Korrektur</Label>
                <Select value={kind} onValueChange={(value) => setKind(value as TimeCorrectionKind)}>
                  <SelectTrigger aria-label="Art der Zeitkorrektur"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sourceKinds.map((value) => (
                      <SelectItem key={value} value={value}>
                        {TIME_CORRECTION_KIND_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {!entry ? (
                <div className="space-y-1.5">
                  <Label>Person</Label>
                  <SearchableSelect
                    ariaLabel="Person für Zeitkorrektur"
                    options={peopleOptions}
                    value={subjectEmployeeRecordId}
                    onChange={setSubjectEmployeeRecordId}
                    searchPlaceholder="Person suchen …"
                    emptyMessage="Keine Person gefunden"
                  />
                </div>
              ) : null}

              {kind === 'reassign' ? (
                <div className="space-y-1.5">
                  <Label>Neue Person</Label>
                  <SearchableSelect
                    ariaLabel="Neue Person für Zeiteintrag"
                    options={peopleOptions}
                    value={targetEmployeeRecordId}
                    onChange={setTargetEmployeeRecordId}
                    searchPlaceholder="Person suchen …"
                    emptyMessage="Keine Person gefunden"
                  />
                </div>
              ) : null}

              {kind !== 'delete' ? (
                <div className="space-y-1.5">
                  <Label>{kind === 'edit' ? 'Neue Zeit' : 'Beginn'}</Label>
                  <DateTimeField value={startAt} onChange={setStartAt} idPrefix="time-correction-start" />
                </div>
              ) : null}
              {kind === 'split' ? (
                <div className="space-y-1.5">
                  <Label>Trennzeit</Label>
                  <DateTimeField value={splitAt} onChange={setSplitAt} idPrefix="time-correction-split" />
                </div>
              ) : null}
              {kind === 'add' || kind === 'missed_clock' || kind === 'split' ? (
                <div className="space-y-1.5">
                  <Label>Ende</Label>
                  <DateTimeField value={endAt} onChange={setEndAt} idPrefix="time-correction-end" />
                </div>
              ) : null}

              {kind === 'reclassify' ? (
                <div className="space-y-1.5">
                  <Label>Neue Tätigkeit</Label>
                  <Select value={activityKind} onValueChange={(value) => setActivityKind(value as TimeSegmentKind)}>
                    <SelectTrigger aria-label="Neue Tätigkeit"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ACTIVITY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {kind === 'reallocate' || kind === 'add' || kind === 'missed_clock' ? (
                <div className="space-y-1.5">
                  <Label>Auftrag</Label>
                  <SearchableSelect
                    ariaLabel="Auftrag für Zeitkorrektur"
                    options={jobOptions}
                    value={jobId}
                    onChange={setJobId}
                    searchPlaceholder="Auftrag suchen …"
                    emptyMessage="Kein Auftrag gefunden"
                  />
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="time-correction-reason">Grund</Label>
                <Textarea
                  id="time-correction-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Was soll korrigiert werden?"
                  maxLength={2000}
                />
              </div>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Abbrechen
          </Button>
          <Button onClick={() => void submit()} disabled={loadingOptions || submitting || !options}>
            {submitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
