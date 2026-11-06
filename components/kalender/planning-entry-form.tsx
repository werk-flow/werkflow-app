'use client';

import { useState } from 'react';
import { useBanner } from '@/components/ui/banner';
import { DialogBody } from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { createPlanningEntry } from '@/lib/planning/actions';
import { usePlanningOptions } from '@/hooks/use-planning-options';
import type { PlanningConflict } from '@/lib/planning/types';
import { errorsByControlId, focusFirstInvalidField } from '@/lib/ui/field-validation';
import { toLocalDateString } from '@/lib/utils';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { calendarRefusalMessage } from '@/lib/calendar/messages';
import {
  checkPlanningEntryDraft,
  getMondayWeekday,
  plannedEntriesMessage,
  type PlanningEntryFieldErrors,
  type PlanningEntryKind,
  type PlanningRecurrenceEndMode,
  type PlanningRecurrenceFrequency,
  type PlanningTimeKind,
} from '@/lib/calendar/planning-entry-draft';
import {
  PlanningEntryAssignmentFields,
  PlanningEntryConflictWarning,
  PlanningEntryInternalDetails,
  PlanningEntryKindFields,
  PlanningEntrySubmitFooter,
} from './planning-entry-fields';
import { PlanningEntryRecurrenceFields, PlanningEntryScheduleFields } from './planning-entry-schedule-fields';
import { useReportPending } from '@/hooks/use-report-pending';
import { usePendingTask } from '@/hooks/use-server-action';
import { useRequestIdempotencyKey } from './use-request-idempotency-key';

interface PlanningEntryFormProps {
  defaultDate?: Date | undefined;
  defaultTime?: string | undefined;
  defaultUserId?: string | undefined;
  /** `note` opens the form as an all-day internal „Sonstiges" entry (the board's note button). */
  onSuccess: () => void | Promise<void>;
  /** Reports the running save, so the hosting dialog stays open until it answers. */
  onPendingChange?: ((pending: boolean) => void) | undefined;
}

/** Every field of the form as the user left it, in the order the form asks for it. */
function usePlanningEntryDraft(initialDate: string, defaultTime: string | undefined) {
  const [entryKind, setEntryKind] = useState<PlanningEntryKind>('job_visit');
  const [jobId, setJobId] = useState('');
  const [internalType, setInternalType] = useState('meeting');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(defaultTime?.slice(0, 5) ?? '09:00');
  const [timeKind, setTimeKind] = useState<PlanningTimeKind>('timed');
  const [durationHours, setDurationHours] = useState('1');
  const [durationDays, setDurationDays] = useState('1');
  // Null until the user changes the assignment; before that the resolved default recipient applies.
  const [chosenEmployeeRecordIds, setEmployeeRecordIds] = useState<string[] | null>(null);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [recurring, setRecurring] = useState(false);
  const [frequency, setFrequency] = useState<PlanningRecurrenceFrequency>('weekly');
  const [interval, setIntervalValue] = useState('1');
  const [weekdays, setWeekdays] = useState<number[]>([getMondayWeekday(initialDate)]);
  const [endMode, setEndMode] = useState<PlanningRecurrenceEndMode>('count');
  const [occurrenceCount, setOccurrenceCount] = useState('6');
  const [untilDate, setUntilDate] = useState('');
  const [conflicts, setConflicts] = useState<PlanningConflict[]>([]);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  return {
    values: {
      entryKind,
      jobId,
      internalType,
      title,
      description,
      location,
      date,
      time,
      timeKind,
      durationHours,
      durationDays,
      teamIds,
      recurring,
      frequency,
      interval,
      weekdays,
      endMode,
      occurrenceCount,
      untilDate,
      overrideReason,
    },
    set: {
      setEntryKind,
      setJobId,
      setInternalType,
      setTitle,
      setDescription,
      setLocation,
      setDate,
      setTime,
      setTimeKind,
      setDurationHours,
      setDurationDays,
      setEmployeeRecordIds,
      setTeamIds,
      setRecurring,
      setFrequency,
      setIntervalValue,
      setWeekdays,
      setEndMode,
      setOccurrenceCount,
      setUntilDate,
      setConflicts,
      setFingerprint,
      setOverrideReason,
    },
    chosenEmployeeRecordIds,
    conflicts,
    fingerprint,
  };
}

type PlanningEntryDraftState = ReturnType<typeof usePlanningEntryDraft>;

type PlanningEntrySubmit = {
  draft: PlanningEntryDraftState;
  employeeRecordIds: string[];
  idempotencyKeyFor: ReturnType<typeof useRequestIdempotencyKey>;
  runSubmit: ReturnType<typeof usePendingTask>['run'];
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  setSubmitError: (message: string | null) => void;
  setFieldErrors: (errors: PlanningEntryFieldErrors) => void;
  onSuccess: PlanningEntryFormProps['onSuccess'];
};

/** Checks the draft; a clean draft goes to the server, which may answer with warnings to review. */
async function submitPlanningEntry({
  draft,
  employeeRecordIds,
  idempotencyKeyFor,
  runSubmit,
  showBanner,
  setSubmitError,
  setFieldErrors,
  onSuccess,
}: PlanningEntrySubmit): Promise<void> {
  const { values, set, conflicts, fingerprint } = draft;
  setSubmitError(null);
  setFieldErrors({});
  const draftCheck = checkPlanningEntryDraft({
    ...values,
    employeeRecordIds,
    hasConflicts: conflicts.length > 0,
  });
  if (draftCheck.kind === 'missing') {
    setFieldErrors(Object.fromEntries(draftCheck.inputs.map(({ field, message }) => [field, message])));
    focusFirstInvalidField(errorsByControlId(draftCheck.inputs));
    return;
  }
  if (draftCheck.kind === 'invalid') {
    setSubmitError(draftCheck.message);
    return;
  }
  const { request } = draftCheck;
  const payload = {
    ...request,
    idempotencyKey: idempotencyKeyFor(request),
    overrideReason: conflicts.length > 0 ? values.overrideReason || null : null,
    assessmentFingerprint: conflicts.length > 0 ? fingerprint : null,
  };
  await runSubmit(async () => {
    try {
      const result = await createPlanningEntry(payload);
      if (result.success) {
        showBanner({ variant: 'success', message: plannedEntriesMessage(result.occurrenceIds.length) });
        await onSuccess();
        return;
      }
      if (
        (result.error === 'planning_warning' || result.error === 'stale_assessment') &&
        result.conflicts &&
        result.fingerprint
      ) {
        set.setConflicts(result.conflicts);
        set.setFingerprint(result.fingerprint);
        if (result.error === 'stale_assessment') {
          showBanner({
            variant: 'info',
            message: 'Die Planungslage hat sich geändert. Bitte Hinweise erneut prüfen.',
          });
        }
        return;
      }
      setSubmitError(calendarRefusalMessage(result.error) ?? 'Der Termin konnte nicht geplant werden.');
    } catch {
      setSubmitError('Der Termin konnte nicht geplant werden.');
    }
  });
}

/** What the entry is, when it runs and who does it. */
function PlanningEntryCoreFields({
  draft,
  fieldErrors,
  jobSearch,
  employeeSearch,
  teamSearch,
}: {
  draft: PlanningEntryDraftState;
  fieldErrors: PlanningEntryFieldErrors;
  jobSearch: ReturnType<typeof usePlanningOptions>;
  employeeSearch: ReturnType<typeof usePlanningOptions>;
  teamSearch: ReturnType<typeof usePlanningOptions>;
}): React.JSX.Element {
  const { values, set } = draft;
  return (
    <>
      <PlanningEntryKindFields
        entryKind={values.entryKind}
        onEntryKindChange={set.setEntryKind}
        jobSelect={jobSearch.select}
        jobId={values.jobId}
        jobError={fieldErrors.job}
        onJobIdChange={set.setJobId}
        internalType={values.internalType}
        onInternalTypeChange={set.setInternalType}
        title={values.title}
        titleError={fieldErrors.title}
        onTitleChange={set.setTitle}
      />

      <PlanningEntryScheduleFields
        date={values.date}
        dateError={fieldErrors.date}
        onDateChange={set.setDate}
        onWeekdaysChange={set.setWeekdays}
        onConflictsChange={set.setConflicts}
        timeKind={values.timeKind}
        onTimeKindChange={set.setTimeKind}
        time={values.time}
        onTimeChange={set.setTime}
        durationHours={values.durationHours}
        onDurationHoursChange={set.setDurationHours}
        durationDays={values.durationDays}
        onDurationDaysChange={set.setDurationDays}
      />

      <PlanningEntryAssignmentFields
        employeeSelect={employeeSearch.select}
        employeeRecordIds={employeeSearch.selectedIds}
        onEmployeeRecordIdsChange={set.setEmployeeRecordIds}
        teamSelect={teamSearch.select}
        teamIds={values.teamIds}
        onTeamIdsChange={set.setTeamIds}
        onConflictsChange={set.setConflicts}
      />
    </>
  );
}

/** The series fields, bound to the draft. */
function PlanningEntryRecurrence({ draft }: { draft: PlanningEntryDraftState }): React.JSX.Element {
  const { values, set } = draft;
  return (
    <PlanningEntryRecurrenceFields
      recurring={values.recurring}
      onRecurringChange={set.setRecurring}
      frequency={values.frequency}
      onFrequencyChange={set.setFrequency}
      interval={values.interval}
      onIntervalChange={set.setIntervalValue}
      weekdays={values.weekdays}
      onWeekdaysChange={set.setWeekdays}
      endMode={values.endMode}
      onEndModeChange={set.setEndMode}
      occurrenceCount={values.occurrenceCount}
      onOccurrenceCountChange={set.setOccurrenceCount}
      untilDate={values.untilDate}
      onUntilDateChange={set.setUntilDate}
    />
  );
}

export function PlanningEntryForm({
  defaultDate,
  defaultTime,
  defaultUserId,
  onSuccess,
  onPendingChange,
}: PlanningEntryFormProps) {
  const initialDate = defaultDate ? toLocalDateString(defaultDate) : getBusinessTodayIso();
  const { showBanner } = useBanner();
  const idempotencyKeyFor = useRequestIdempotencyKey();
  const { run: runSubmit, isPending: submitting } = usePendingTask();
  useReportPending(submitting, onPendingChange);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<PlanningEntryFieldErrors>({});
  const draft = usePlanningEntryDraft(initialDate, defaultTime);
  const { values, set, conflicts } = draft;

  const employeeSearch = usePlanningOptions(
    'employees',
    draft.chosenEmployeeRecordIds,
    defaultUserId ? [defaultUserId] : [],
  );
  const jobSearch = usePlanningOptions('jobs', values.jobId ? [values.jobId] : []);
  const teamSearch = usePlanningOptions('teams', values.teamIds);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    await submitPlanningEntry({
      draft,
      employeeRecordIds: employeeSearch.selectedIds,
      idempotencyKeyFor,
      runSubmit,
      showBanner,
      setSubmitError,
      setFieldErrors,
      onSuccess,
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="space-y-5 pt-2">
        <PlanningEntryCoreFields
          draft={draft}
          fieldErrors={fieldErrors}
          jobSearch={jobSearch}
          employeeSearch={employeeSearch}
          teamSearch={teamSearch}
        />

        <PlanningEntryRecurrence draft={draft} />

        {values.entryKind === 'internal' && (
          <PlanningEntryInternalDetails
            location={values.location}
            onLocationChange={set.setLocation}
            description={values.description}
            onDescriptionChange={set.setDescription}
          />
        )}

        {conflicts.length > 0 && (
          <PlanningEntryConflictWarning
            conflicts={conflicts}
            overrideReason={values.overrideReason}
            overrideError={fieldErrors.override}
            onOverrideReasonChange={set.setOverrideReason}
          />
        )}

        <ErrorText>{submitError}</ErrorText>
      </DialogBody>

      <PlanningEntrySubmitFooter
        submitting={submitting}
        resolvingDefaults={employeeSearch.resolvingDefaults}
        hasConflicts={conflicts.length > 0}
      />
    </form>
  );
}
