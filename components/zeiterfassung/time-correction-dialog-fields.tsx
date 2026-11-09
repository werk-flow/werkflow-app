'use client';

import { DatePicker } from '@/components/ui/date-picker';
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
import { Constants } from '@/lib/supabase/database.types';
import { constrainedValue } from '@/lib/validation/constrained-value';
import { isManagerRole } from '@/lib/roles';
import { parseIsoLocalDate, toLocalDateString } from '@/lib/utils';
import { CorrectionTimelineFields } from './time-correction-dialog-timeline';
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

/**
 * Whose time the correction changes. Only Admin and Büro correct other
 * people's time; everyone else corrects their own and sees no person field.
 */
function TimeCorrectionPersonFields({
  entry,
  form,
  canChoosePerson,
}: TimeCorrectionDialogFieldsProps & { canChoosePerson: boolean }) {
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
      {!entry && canChoosePerson ? (
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
      {kind === 'split' ? (
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

/** Added time: the day, then what happened that day, activity by activity. */
function AddedTimeFields({ form }: { form: TimeCorrectionDialogForm }) {
  const { dateIso, setDateIso, fieldErrors, timeline, showTimelineErrors } = form;
  return (
    <>
      <Field
        label="Datum"
        htmlFor="time-correction-date"
        required
        error={fieldErrors.date}
        className="gap-1.5"
      >
        <DatePicker
          ariaLabel="Datum"
          value={parseIsoLocalDate(dateIso)}
          onChange={(date) => setDateIso(date ? toLocalDateString(date) : '')}
          placeholder="Datum wählen"
        />
      </Field>
      <CorrectionTimelineFields timeline={timeline} showErrors={showTimelineErrors} />
    </>
  );
}

function TimeCorrectionFieldsSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true">
      <span className="sr-only">Daten werden geladen.</span>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

function TimeCorrectionActivityField({
  activityKind,
  setActivityKind,
}: Pick<TimeCorrectionDialogForm, 'activityKind' | 'setActivityKind'>) {
  return (
    <Field label="Neue Tätigkeit" className="gap-1.5">
      <Select
        value={activityKind}
        onValueChange={(value) =>
          setActivityKind(constrainedValue(Constants.public.Enums.time_segment_kind, value, 'activity kind'))
        }
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
  );
}

function TimeCorrectionJobField({
  jobSearch,
  jobId,
  setJobId,
}: Pick<TimeCorrectionDialogForm, 'jobId' | 'setJobId'> & {
  jobSearch: ReturnType<typeof useJobEntityOptions>;
}) {
  return (
    <Field label="Auftrag" className="gap-1.5">
      <SearchableSelect
        ariaLabel="Auftrag für Zeitkorrektur"
        options={[{ value: 'none', label: 'Ohne Auftrag' }, ...jobSearch.options]}
        value={jobId}
        onChange={setJobId}
        onSearchChange={jobSearch.onSearchChange}
        loading={jobSearch.loading}
        loadFailure={jobSearch.loadFailure}
        onLoadMore={jobSearch.onLoadMore}
        searchPlaceholder="Auftrag suchen …"
        emptyMessage="Kein Auftrag gefunden"
      />
    </Field>
  );
}

/** What a correction of an entry changes. */
function TimeCorrectionKindField({
  kind,
  setKind,
  isOffice,
}: Pick<TimeCorrectionDialogForm, 'kind' | 'setKind'> & { isOffice: boolean }) {
  return (
    <Field label="Korrektur" className="gap-1.5">
      <Select
        value={kind}
        onValueChange={(value) =>
          setKind(constrainedValue(Constants.public.Enums.time_correction_kind, value, 'correction kind'))
        }
      >
        <SelectTrigger aria-label="Art der Zeitkorrektur">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {/* Only Admin and Büro move an entry to another person. */}
          {SOURCE_KINDS.filter((value) => value !== 'reassign' || isOffice).map((value) => (
            <SelectItem key={value} value={value}>
              {TIME_CORRECTION_KIND_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
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
  // Moving time to another person, or choosing whose time is added, is an
  // office decision: only Admin and Büro see it.
  const callerRole = options?.people.find(
    (person) => person.employeeRecordId === options.currentEmployeeRecordId,
  )?.role;
  const isOffice = callerRole !== undefined && isManagerRole(callerRole);

  return (
    <>
      {loadingOptions || !options ? (
        <TimeCorrectionFieldsSkeleton />
      ) : (
        <>
          {/* Added time has one kind („Zeit nachtragen“); only a correction of an entry chooses what changes. */}
          {entry ? <TimeCorrectionKindField kind={kind} setKind={setKind} isOffice={isOffice} /> : null}

          <TimeCorrectionPersonFields entry={entry} form={form} canChoosePerson={isOffice} />

          {entry ? <TimeCorrectionTimeFields form={form} /> : <AddedTimeFields form={form} />}

          {kind === 'reclassify' ? (
            <TimeCorrectionActivityField activityKind={activityKind} setActivityKind={setActivityKind} />
          ) : null}

          {kind === 'reallocate' ? (
            <TimeCorrectionJobField jobSearch={jobSearch} jobId={jobId} setJobId={setJobId} />
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
