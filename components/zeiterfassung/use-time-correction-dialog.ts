'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { useServerAction } from '@/hooks/use-server-action';
import { SHARED_FAILURE_MESSAGES } from '@/lib/action-messages';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { readInBackground } from '@/lib/data/background-read-client';
import { submitTimeCorrection } from '@/lib/time-corrections/actions';
import type { SubmitTimeCorrectionInput } from '@/lib/time-corrections/validation';
import type { TimeCorrectionFormOptions } from '@/lib/time-corrections/read-actions';
import type { TimeCorrectionKind } from '@/lib/time-corrections/types';
import {
  isDateInClosedPeriod,
  isEntryInClosedPeriod,
  type ClosedTimePeriod,
} from '@/lib/time-tracking/closed-period-dates';
import type { TimeEntry, TimeSegmentKind } from '@/lib/time-tracking/types';
import { formatBerlinLocalDate, getBusinessTodayIso } from '@/lib/date-time/berlin';
import { buildTimelineFacts } from '@/lib/time-corrections/timeline';
import type { CorrectionOperation } from '@/components/correction-operation';
import { buildTimeCorrectionProposedFacts } from './time-correction-dialog-facts';
import { sendTimeCorrection, TIME_CORRECTION_SAVE_FAILURE } from './time-correction-dialog-send';
import { useCorrectionTimeline, type CorrectionTimelineState } from './time-correction-dialog-timeline-state';

function toLocalDateTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function oneHourAfter(value: string): string {
  const date = new Date(value || Date.now());
  date.setHours(date.getHours() + 1);
  return toLocalDateTime(date.toISOString());
}

type TimeCorrectionFieldErrors = {
  person?: string | undefined;
  date?: string | undefined;
  startAt?: string | undefined;
  splitAt?: string | undefined;
  endAt?: string | undefined;
  reason?: string | undefined;
};

const MISSING_TIME_MESSAGE = 'Bitte gib Datum und Uhrzeit an.';

function isCompleteLocalDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

// The time fields a correction of an entry shows must be complete and in
// order (start, split, end); a deletion has none.
function validateTimeCorrectionTimes({
  kind,
  startAt,
  splitAt,
  endAt,
}: {
  kind: TimeCorrectionKind;
  startAt: string;
  splitAt: string;
  endAt: string;
}): Pick<TimeCorrectionFieldErrors, 'startAt' | 'splitAt' | 'endAt'> {
  if (kind === 'delete') return {};
  const startError = isCompleteLocalDateTime(startAt) ? undefined : MISSING_TIME_MESSAGE;
  if (kind !== 'split') return { startAt: startError };
  const endError = isCompleteLocalDateTime(endAt) ? undefined : MISSING_TIME_MESSAGE;
  const splitError = isCompleteLocalDateTime(splitAt) ? undefined : MISSING_TIME_MESSAGE;
  if (startError || splitError || endError) {
    return { startAt: startError, splitAt: splitError, endAt: endError };
  }
  // Same-format local values compare correctly as strings.
  if (!(startAt < splitAt && splitAt < endAt)) {
    return { splitAt: 'Die Trennzeit muss zwischen Beginn und Ende liegen.' };
  }
  return {};
}

// A time on a day of a closed period is refused with `period_closed`; the
// field says so before the request.
function closedPeriodTimeErrors(
  {
    kind,
    startAt,
    splitAt,
    endAt,
  }: { kind: TimeCorrectionKind; startAt: string; splitAt: string; endAt: string },
  closedPeriods: readonly ClosedTimePeriod[],
): Pick<TimeCorrectionFieldErrors, 'startAt' | 'splitAt' | 'endAt'> {
  if (kind === 'delete') return {};
  const closed = (value: string): string | undefined =>
    isDateInClosedPeriod(value.slice(0, 10), closedPeriods)
      ? SHARED_FAILURE_MESSAGES.period_closed
      : undefined;
  return {
    startAt: closed(startAt),
    splitAt: kind === 'split' ? closed(splitAt) : undefined,
    endAt: kind === 'split' ? closed(endAt) : undefined,
  };
}

type ShowBanner = ReturnType<typeof useBanner>['showBanner'];

// The dialog cannot work without its options: say so and close it.
function closeOnOptionsLoadFailure(showBanner: ShowBanner, setOpen: (nextOpen: boolean) => void): void {
  showBanner({
    variant: 'error',
    message: 'Die Korrekturmaske konnte nicht geladen werden.',
  });
  setOpen(false);
}

// The entry's person, or the caller's own record when the correction adds time.
function initialSubjectEmployeeRecordId(
  options: TimeCorrectionFormOptions,
  entry: TimeEntry | undefined,
): string {
  const sourcePerson = entry ? options.people.find((person) => person.userId === entry.userId) : null;
  return sourcePerson?.employeeRecordId ?? options.currentEmployeeRecordId;
}

type TimeCorrectionDialogSessionInput = {
  organizationId: string;
  entry: TimeEntry | undefined;
  controlledOpen: boolean | undefined;
  onOpenChange: ((open: boolean) => void) | undefined;
  showBanner: ShowBanner;
};

// The state that restarts with every opening of the dialog: the loaded form
// options, the person and job selection, and the last save failure.
function useTimeCorrectionDialogSession({
  organizationId,
  entry,
  controlledOpen,
  onOpenChange,
  showBanner,
}: TimeCorrectionDialogSessionInput) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  // Callers pass an inline onOpenChange; a stable setOpen keeps a parent
  // re-render (a live update) from rerunning the opening effect, which would
  // reload the options and clear the selection.
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });
  const setOpen = useCallback((nextOpen: boolean) => {
    setInternalOpen(nextOpen);
    onOpenChangeRef.current?.(nextOpen);
  }, []);
  // One operation per opening, with the content that may have been saved
  // under it: a retry after a lost response replays the saved request instead
  // of reporting a conflict, and an edit since then must not pass as saved.
  const operationRef = useRef<CorrectionOperation | null>(null);
  const [loadedOptions, setLoadedOptions] = useState<{
    organizationId: string;
    value: TimeCorrectionFormOptions;
  } | null>(null);
  const options = loadedOptions?.organizationId === organizationId ? loadedOptions.value : null;
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [subjectEmployeeRecordId, setSubjectEmployeeRecordId] = useState('');
  const [targetEmployeeRecordId, setTargetEmployeeRecordId] = useState('');
  const [jobId, setJobId] = useState(entry?.jobId ?? 'none');
  // Save failures stay inside the dialog at the point of action; the dialog
  // never closes on failure.
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Over GET: opening the dialog never queues behind a save.
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- every opening starts from a clean selection while the form options load
    setLoadingOptions(true);
    operationRef.current = null;
    setLoadedOptions(null);
    setSubmitError(null);
    setSubjectEmployeeRecordId('');
    setTargetEmployeeRecordId('');
    setJobId(entry?.jobId ?? 'none');

    void readInBackground('time-correction-form-options', { organizationId }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.success) {
          closeOnOptionsLoadFailure(showBanner, setOpen);
          return;
        }
        setLoadedOptions({ organizationId, value: result.options });
        const subjectId = initialSubjectEmployeeRecordId(result.options, entry);
        setSubjectEmployeeRecordId(subjectId);
        setTargetEmployeeRecordId(subjectId);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        closeOnOptionsLoadFailure(showBanner, setOpen);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingOptions(false);
      });

    return () => controller.abort();
  }, [entry, open, organizationId, setOpen, showBanner]);

  return {
    open,
    setOpen,
    options,
    loadingOptions,
    subjectEmployeeRecordId,
    setSubjectEmployeeRecordId,
    targetEmployeeRecordId,
    setTargetEmployeeRecordId,
    jobId,
    setJobId,
    submitError,
    setSubmitError,
    operationRef,
  };
}

type TimeCorrectionDialogFormInput = {
  organizationId: string;
  entry: TimeEntry | undefined;
  onSubmitted: (() => void) | undefined;
  controlledOpen: boolean | undefined;
  onOpenChange: ((open: boolean) => void) | undefined;
  closedPeriods: readonly ClosedTimePeriod[];
};

export type TimeCorrectionDialogForm = {
  open: boolean;
  setOpen: (nextOpen: boolean) => void;
  options: TimeCorrectionFormOptions | null;
  loadingOptions: boolean;
  submitting: boolean;
  submitError: string | null;
  submit: () => Promise<void>;
  kind: TimeCorrectionKind;
  setKind: (value: TimeCorrectionKind) => void;
  startAt: string;
  setStartAt: (value: string) => void;
  splitAt: string;
  setSplitAt: (value: string) => void;
  endAt: string;
  setEndAt: (value: string) => void;
  reason: string;
  setReason: (value: string) => void;
  subjectEmployeeRecordId: string;
  setSubjectEmployeeRecordId: (value: string) => void;
  targetEmployeeRecordId: string;
  setTargetEmployeeRecordId: (value: string) => void;
  jobId: string;
  setJobId: (value: string) => void;
  activityKind: TimeSegmentKind;
  setActivityKind: (value: TimeSegmentKind) => void;
  fieldErrors: TimeCorrectionFieldErrors;
  /** Added time: the Berlin day its timeline starts on, `YYYY-MM-DD`, '' while none is chosen. */
  dateIso: string;
  setDateIso: (value: string) => void;
  timeline: CorrectionTimelineState;
  /** „Speichern“ was pressed: the timeline's rows show their errors. */
  showTimelineErrors: boolean;
};

// The source a correction changes: the canonical segment, the applied
// correction, or the entry itself.
function correctionSource(
  entry: TimeEntry | undefined,
): { kind: NonNullable<TimeEntry['sourceKind']>; id: string } | null {
  if (!entry?.sourceKind) return null;
  const id =
    entry.sourceKind === 'canonical_segment'
      ? entry.canonicalSegmentId
      : entry.sourceKind === 'correction_application'
        ? entry.correctionApplicationId
        : entry.id;
  return id ? { kind: entry.sourceKind, id } : null;
}

// Every field error of a submit: a missing person or reason, an incomplete or
// unordered time, then a time in a closed period.
function timeCorrectionFieldErrors(
  times: { kind: TimeCorrectionKind; startAt: string; splitAt: string; endAt: string },
  closedPeriods: readonly ClosedTimePeriod[],
  subjectEmployeeRecordId: string,
  reason: string,
): TimeCorrectionFieldErrors {
  const timeErrors = validateTimeCorrectionTimes(times);
  const closedErrors = closedPeriodTimeErrors(times, closedPeriods);
  return {
    person: subjectEmployeeRecordId ? undefined : 'Bitte wähle eine Person aus.',
    startAt: timeErrors.startAt ?? closedErrors.startAt,
    splitAt: timeErrors.splitAt ?? closedErrors.splitAt,
    endAt: timeErrors.endAt ?? closedErrors.endAt,
    reason: reason.trim() ? undefined : 'Bitte gib einen Grund an.',
  };
}

// The field ids in form order, for focusFirstInvalidField.
function timeCorrectionFieldIds(errors: TimeCorrectionFieldErrors): Record<string, string | undefined> {
  return {
    'time-correction-person': errors.person,
    'time-correction-date': errors.date,
    'time-correction-start-date': errors.startAt,
    'time-correction-split-date': errors.splitAt,
    'time-correction-end-date': errors.endAt,
    'time-correction-reason': errors.reason,
  };
}

// The fields of one correction, from the entry it starts with.
function useTimeCorrectionFieldState(entry: TimeEntry | undefined) {
  // Added time is one kind: 'add' and the older 'missed_clock' apply alike.
  const [kind, setKind] = useState<TimeCorrectionKind>(entry ? 'edit' : 'add');
  const initialStart = toLocalDateTime(entry?.timestamp ?? new Date().toISOString());
  const [startAt, setStartAt] = useState(initialStart);
  const [splitAt, setSplitAt] = useState(oneHourAfter(initialStart));
  const [endAt, setEndAt] = useState(oneHourAfter(initialStart));
  const [reason, setReason] = useState('');
  const [activityKind, setActivityKind] = useState<TimeSegmentKind>(entry?.activityKind ?? 'work');
  const [fieldErrors, setFieldErrors] = useState<TimeCorrectionFieldErrors>({});
  return {
    kind,
    setKind,
    startAt,
    setStartAt,
    splitAt,
    setSplitAt,
    endAt,
    setEndAt,
    reason,
    setReason,
    activityKind,
    setActivityKind,
    fieldErrors,
    setFieldErrors,
  };
}

type ProposedFacts = SubmitTimeCorrectionInput['proposedFacts'];
type CorrectionPlan = { fieldErrors: TimeCorrectionFieldErrors; proposedFacts: ProposedFacts | null };

/** A correction of an entry: its fields' errors, else the facts it proposes. */
function planEntryCorrection(
  entry: TimeEntry,
  fields: Pick<
    TimeCorrectionDialogForm,
    'kind' | 'startAt' | 'splitAt' | 'endAt' | 'reason' | 'activityKind'
  >,
  people: {
    closedPeriods: readonly ClosedTimePeriod[];
    subjectEmployeeRecordId: string;
    targetEmployeeRecordId: string;
    jobId: string;
  },
): CorrectionPlan {
  const { kind, startAt, splitAt, endAt } = fields;
  const fieldErrors = timeCorrectionFieldErrors(
    { kind, startAt, splitAt, endAt },
    people.closedPeriods,
    people.subjectEmployeeRecordId,
    fields.reason,
  );
  if (focusFirstInvalidField(timeCorrectionFieldIds(fieldErrors)))
    return { fieldErrors, proposedFacts: null };
  return {
    fieldErrors,
    proposedFacts: buildTimeCorrectionProposedFacts({
      kind,
      entry,
      // A reassignment proposes the entry's time for the new person.
      baseEmployeeRecordId:
        kind === 'reassign' ? people.targetEmployeeRecordId : people.subjectEmployeeRecordId,
      jobId: people.jobId,
      activityKind: fields.activityKind,
      startAt,
      splitAt,
      endAt,
    }),
  };
}

/**
 * Added time: the person, the day, every activity of the timeline and the
 * reason, else the timeline's facts. A day of a closed period is marked
 * before the request.
 */
function planAddedTime(input: {
  dateIso: string;
  timeline: CorrectionTimelineState;
  closedPeriods: readonly ClosedTimePeriod[];
  subjectEmployeeRecordId: string;
  reason: string;
}): CorrectionPlan {
  const { resolved, fieldErrors: timelineErrors } = input.timeline.validate();
  const segments = resolved.valid ? resolved.segments : [];
  const touchesClosedDay = segments.some((segment) =>
    [segment.startedAt, new Date(segment.endedAt.getTime() - 1)].some((instant) =>
      isDateInClosedPeriod(formatBerlinLocalDate(instant), input.closedPeriods),
    ),
  );
  const fieldErrors: TimeCorrectionFieldErrors = {
    person: input.subjectEmployeeRecordId ? undefined : 'Bitte wähle eine Person aus.',
    date: !input.dateIso
      ? 'Bitte wähle ein Datum.'
      : touchesClosedDay
        ? SHARED_FAILURE_MESSAGES.period_closed
        : undefined,
    reason: input.reason.trim() ? undefined : 'Bitte gib einen Grund an.',
  };
  const invalid = focusFirstInvalidField({
    'time-correction-person': fieldErrors.person,
    'time-correction-date': fieldErrors.date,
    ...timelineErrors,
    'time-correction-reason': fieldErrors.reason,
  });
  return {
    fieldErrors,
    proposedFacts: invalid ? null : buildTimelineFacts(segments, input.subjectEmployeeRecordId),
  };
}

/** Added time: its day, its timeline, and whether „Speichern“ was pressed, which shows the rows' errors. */
function useAddedTimeState(input: {
  organizationId: string;
  subjectEmployeeRecordId: string;
  enabled: boolean;
}) {
  const [dateIso, setDateIso] = useState(getBusinessTodayIso);
  const [attempted, setAttempted] = useState(false);
  const timeline = useCorrectionTimeline({
    organizationId: input.organizationId,
    employeeRecordId: input.subjectEmployeeRecordId || undefined,
    dateIso: /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? dateIso : null,
    enabled: input.enabled && Boolean(input.subjectEmployeeRecordId),
  });
  return { dateIso, setDateIso, timeline, attempted, setAttempted };
}

export function useTimeCorrectionDialogForm({
  organizationId,
  entry,
  onSubmitted,
  controlledOpen,
  onOpenChange,
  closedPeriods,
}: TimeCorrectionDialogFormInput): TimeCorrectionDialogForm {
  const { showBanner } = useBanner();
  const session = useTimeCorrectionDialogSession({
    organizationId,
    entry,
    controlledOpen,
    onOpenChange,
    showBanner,
  });
  const { operationRef, ...sessionState } = session;
  const { setOpen, subjectEmployeeRecordId, targetEmployeeRecordId, jobId, setSubmitError } = sessionState;
  const { run: runSubmit, isPending: submitting } = useServerAction(submitTimeCorrection);
  const { setFieldErrors, ...fields } = useTimeCorrectionFieldState(entry);
  const { kind, reason, setReason } = fields;
  const { dateIso, setDateIso, timeline, attempted, setAttempted } = useAddedTimeState({
    organizationId,
    subjectEmployeeRecordId,
    enabled: sessionState.open && !entry,
  });

  const source = useMemo(() => correctionSource(entry), [entry]);

  const submit = async () => {
    if (!entry) setAttempted(true);
    const plan = entry
      ? planEntryCorrection(entry, fields, {
          closedPeriods,
          subjectEmployeeRecordId,
          targetEmployeeRecordId,
          jobId,
        })
      : planAddedTime({ dateIso, timeline, closedPeriods, subjectEmployeeRecordId, reason });
    setFieldErrors(plan.fieldErrors);
    if (!plan.proposedFacts) return;
    if (entry && isEntryInClosedPeriod(entry, closedPeriods)) {
      setSubmitError(SHARED_FAILURE_MESSAGES.period_closed);
      return;
    }

    setSubmitError(null);
    try {
      const answer = await sendTimeCorrection(
        operationRef,
        {
          organizationId,
          subjectEmployeeRecordId,
          kind,
          reason,
          source: kind === 'add' || kind === 'missed_clock' ? null : source,
          proposedFacts: plan.proposedFacts,
        },
        runSubmit,
      );
      if (!answer.saved) {
        setSubmitError(answer.message);
        return;
      }
      showBanner({ variant: 'success', message: answer.message });
      setOpen(false);
      setReason('');
      onSubmitted?.();
    } catch {
      setSubmitError(TIME_CORRECTION_SAVE_FAILURE);
    }
  };

  return {
    ...sessionState,
    submitting,
    submit,
    ...fields,
    dateIso,
    setDateIso,
    timeline,
    showTimelineErrors: attempted,
  };
}
