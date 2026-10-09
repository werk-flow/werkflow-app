'use client';

import { DateTimeField } from '@/components/ui/date-time-field';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { TIME_CORRECTION_KIND_LABELS, type TimeCorrectionKind } from '@/lib/time-corrections/types';
import type { TimeEntry, TimeSegmentKind } from '@/lib/time-tracking/types';
import type { TimeCorrectionDialogForm } from './use-time-correction-dialog';

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

type TimeCorrectionDialogFieldsProps = {
  entry: TimeEntry | undefined;
  form: TimeCorrectionDialogForm;
};

function TimeCorrectionPersonFields({ entry, form }: TimeCorrectionDialogFieldsProps) {
  const {
    options,
    kind,
    fieldErrors,
    subjectEmployeeRecordId,
    setSubjectEmployeeRecordId,
    targetEmployeeRecordId,
    setTargetEmployeeRecordId,
  } = form;
  const peopleOptions =
    options?.people.map((person) => ({
      value: person.employeeRecordId,
      label: person.name,
    })) ?? [];

  return (
    <>
      {!entry ? (
        <Field
          label="Person"
          htmlFor="time-correction-person"
          required
          error={fieldErrors.person}
          className="gap-1.5"
        >
          <SearchableSelect
            ariaLabel="Person für Zeitkorrektur"
            options={peopleOptions}
            value={subjectEmployeeRecordId}
            onChange={setSubjectEmployeeRecordId}
            searchPlaceholder="Person suchen …"
            emptyMessage="Keine Person gefunden"
          />
        </Field>
      ) : null}

      {kind === 'reassign' ? (
        <Field label="Neue Person" htmlFor="time-correction-target-person" required className="gap-1.5">
          <SearchableSelect
            ariaLabel="Neue Person für Zeiteintrag"
            options={peopleOptions}
            value={targetEmployeeRecordId}
            onChange={setTargetEmployeeRecordId}
            searchPlaceholder="Person suchen …"
            emptyMessage="Keine Person gefunden"
          />
        </Field>
      ) : null}
    </>
  );
}

function TimeCorrectionTimeFields({ form }: { form: TimeCorrectionDialogForm }) {
  const { kind, startAt, setStartAt, splitAt, setSplitAt, endAt, setEndAt, fieldErrors } = form;

  return (
    <>
      {kind !== 'delete' ? (
        <Field
          label={kind === 'edit' ? 'Neue Zeit' : 'Beginn'}
          htmlFor="time-correction-start-date"
          required
          error={fieldErrors.startAt}
          className="gap-1.5"
        >
          <DateTimeField value={startAt} onChange={setStartAt} idPrefix="time-correction-start" />
        </Field>
      ) : null}
      {kind === 'split' ? (
        <Field
          label="Trennzeit"
          htmlFor="time-correction-split-date"
          required
          error={fieldErrors.splitAt}
          className="gap-1.5"
        >
          <DateTimeField value={splitAt} onChange={setSplitAt} idPrefix="time-correction-split" />
        </Field>
      ) : null}
      {kind === 'add' || kind === 'missed_clock' || kind === 'split' ? (
        <Field
          label="Ende"
          htmlFor="time-correction-end-date"
          required
          error={fieldErrors.endAt}
          className="gap-1.5"
        >
          <DateTimeField value={endAt} onChange={setEndAt} idPrefix="time-correction-end" />
        </Field>
      ) : null}
    </>
  );
}

export function TimeCorrectionDialogFields({ entry, form }: TimeCorrectionDialogFieldsProps) {
  const {
    loadingOptions,
    options,
    kind,
    setKind,
    fieldErrors,
    reason,
    setReason,
    activityKind,
    setActivityKind,
    jobId,
    setJobId,
    submitError,
  } = form;
  // Open jobs of the whole organization, searched on the server; „Ohne Auftrag“ stays first.
  const jobSearch = useJobEntityOptions(
    { kind: 'jobs', purpose: 'time-correction' },
    jobId && jobId !== 'none' ? [jobId] : [],
  );
  const jobOptions = [{ value: 'none', label: 'Ohne Auftrag' }, ...jobSearch.options];
  const sourceKinds = entry ? SOURCE_KINDS : (['add', 'missed_clock'] as TimeCorrectionKind[]);

  return (
    <>
      {loadingOptions || !options ? (
        <div className="space-y-4" role="status" aria-busy="true">
          <span className="sr-only">Daten werden geladen.</span>
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <Field label="Korrektur" className="gap-1.5">
            <Select value={kind} onValueChange={(value) => setKind(value as TimeCorrectionKind)}>
              <SelectTrigger aria-label="Art der Zeitkorrektur">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sourceKinds.map((value) => (
                  <SelectItem key={value} value={value}>
                    {TIME_CORRECTION_KIND_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <TimeCorrectionPersonFields entry={entry} form={form} />

          <TimeCorrectionTimeFields form={form} />

          {kind === 'reclassify' ? (
            <Field label="Neue Tätigkeit" className="gap-1.5">
              <Select
                value={activityKind}
                onValueChange={(value) => setActivityKind(value as TimeSegmentKind)}
              >
                <SelectTrigger aria-label="Neue Tätigkeit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {kind === 'reallocate' || kind === 'add' || kind === 'missed_clock' ? (
            <Field label="Auftrag" className="gap-1.5">
              <SearchableSelect
                ariaLabel="Auftrag für Zeitkorrektur"
                options={jobOptions}
                value={jobId}
                onChange={setJobId}
                onSearchChange={jobSearch.onSearchChange}
                loading={jobSearch.loading}
                loadError={jobSearch.loadError}
                onRetryLoad={jobSearch.onRetryLoad}
                onLoadMore={jobSearch.onLoadMore}
                searchPlaceholder="Auftrag suchen …"
                emptyMessage="Kein Auftrag gefunden"
              />
            </Field>
          ) : null}

          <Field
            label="Grund"
            htmlFor="time-correction-reason"
            required
            error={fieldErrors.reason}
            className="gap-1.5"
          >
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Was soll korrigiert werden?"
              maxLength={2000}
            />
          </Field>
          <ErrorText>{submitError}</ErrorText>
        </>
      )}
    </>
  );
}
