'use client';

import { useState } from 'react';
import { useBanner } from '@/components/ui/banner';
import { DialogBody } from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { createPlanningEntry } from '@/lib/planning/actions';
import { usePlanningOptions } from '@/hooks/use-planning-options';
import type { PlanningConflict } from '@/lib/planning/types';
import { toLocalDateString } from '@/lib/utils';
import { getBusinessTodayIso } from '@/lib/personnel/types';
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
import { useReportedPendingState } from '@/hooks/use-report-pending';
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
  const [submitting, setSubmitting] = useReportedPendingState(onPendingChange);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<PlanningEntryFieldErrors>({});
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

  const employeeSearch = usePlanningOptions(
    'employees',
    chosenEmployeeRecordIds,
    defaultUserId ? [defaultUserId] : [],
  );
  const employeeRecordIds = employeeSearch.selectedIds;
  const jobSearch = usePlanningOptions('jobs', jobId ? [jobId] : []);
  const teamSearch = usePlanningOptions('teams', teamIds);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    setFieldErrors({});
    const draftCheck = checkPlanningEntryDraft({
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
      employeeRecordIds,
      teamIds,
      recurring,
      frequency,
      interval,
      weekdays,
      endMode,
      occurrenceCount,
      untilDate,
      hasConflicts: conflicts.length > 0,
      overrideReason,
    });
    if (draftCheck.kind === 'missing') {
      setFieldErrors(Object.fromEntries(draftCheck.inputs.map(({ field, message }) => [field, message])));
      document.getElementById(draftCheck.inputs[0].elementId)?.focus();
      return;
    }
    if (draftCheck.kind === 'invalid') {
      setSubmitError(draftCheck.message);
      return;
    }
    setSubmitting(true);
    const { request } = draftCheck;
    const payload = {
      ...request,
      idempotencyKey: idempotencyKeyFor(request),
      overrideReason: conflicts.length > 0 ? overrideReason || null : null,
      assessmentFingerprint: conflicts.length > 0 ? fingerprint : null,
    };
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
        setConflicts(result.conflicts);
        setFingerprint(result.fingerprint);
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
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="space-y-5 pt-2">
        <PlanningEntryKindFields
          entryKind={entryKind}
          onEntryKindChange={setEntryKind}
          jobSelect={jobSearch.select}
          jobId={jobId}
          jobError={fieldErrors.job}
          onJobIdChange={setJobId}
          internalType={internalType}
          onInternalTypeChange={setInternalType}
          title={title}
          titleError={fieldErrors.title}
          onTitleChange={setTitle}
        />

        <PlanningEntryScheduleFields
          date={date}
          dateError={fieldErrors.date}
          onDateChange={setDate}
          onWeekdaysChange={setWeekdays}
          onConflictsChange={setConflicts}
          timeKind={timeKind}
          onTimeKindChange={setTimeKind}
          time={time}
          onTimeChange={setTime}
          durationHours={durationHours}
          onDurationHoursChange={setDurationHours}
          durationDays={durationDays}
          onDurationDaysChange={setDurationDays}
        />

        <PlanningEntryAssignmentFields
          employeeSelect={employeeSearch.select}
          employeeRecordIds={employeeRecordIds}
          onEmployeeRecordIdsChange={setEmployeeRecordIds}
          teamSelect={teamSearch.select}
          teamIds={teamIds}
          onTeamIdsChange={setTeamIds}
          onConflictsChange={setConflicts}
        />

        <PlanningEntryRecurrenceFields
          recurring={recurring}
          onRecurringChange={setRecurring}
          frequency={frequency}
          onFrequencyChange={setFrequency}
          interval={interval}
          onIntervalChange={setIntervalValue}
          weekdays={weekdays}
          onWeekdaysChange={setWeekdays}
          endMode={endMode}
          onEndModeChange={setEndMode}
          occurrenceCount={occurrenceCount}
          onOccurrenceCountChange={setOccurrenceCount}
          untilDate={untilDate}
          onUntilDateChange={setUntilDate}
        />

        {entryKind === 'internal' && (
          <PlanningEntryInternalDetails
            location={location}
            onLocationChange={setLocation}
            description={description}
            onDescriptionChange={setDescription}
          />
        )}

        {conflicts.length > 0 && (
          <PlanningEntryConflictWarning
            conflicts={conflicts}
            overrideReason={overrideReason}
            overrideError={fieldErrors.override}
            onOverrideReasonChange={setOverrideReason}
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
