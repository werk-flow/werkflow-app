'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { describeFailure } from '@/lib/action-messages';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import {
  getTimeCorrectionFormOptions,
  submitTimeCorrection,
  type TimeCorrectionFormOptions,
} from '@/lib/time-corrections/actions';
import { TIME_CORRECTION_FAILURE_MESSAGES } from '@/lib/time-corrections/messages';
import type { TimeCorrectionKind } from '@/lib/time-corrections/types';
import type { TimeEntry, TimeSegmentKind } from '@/lib/time-tracking/types';
import { buildTimeCorrectionProposedFacts } from './time-correction-dialog-facts';

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
  startAt?: string | undefined;
  splitAt?: string | undefined;
  endAt?: string | undefined;
  reason?: string | undefined;
};

const MISSING_TIME_MESSAGE = 'Bitte gib Datum und Uhrzeit an.';

function isCompleteLocalDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

// The time fields the kind shows must be complete and in order
// (start, split, end); a deletion has none.
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
  const hasEnd = kind === 'add' || kind === 'missed_clock' || kind === 'split';
  if (!hasEnd) return { startAt: startError };
  const endError = isCompleteLocalDateTime(endAt) ? undefined : MISSING_TIME_MESSAGE;
  const splitError = kind === 'split' && !isCompleteLocalDateTime(splitAt) ? MISSING_TIME_MESSAGE : undefined;
  if (startError || splitError || endError) {
    return { startAt: startError, splitAt: splitError, endAt: endError };
  }
  // Same-format local values compare correctly as strings.
  if (kind === 'split' && !(startAt < splitAt && splitAt < endAt)) {
    return { splitAt: 'Die Trennzeit muss zwischen Beginn und Ende liegen.' };
  }
  if (startAt >= endAt) return { endAt: 'Das Ende muss nach dem Beginn liegen.' };
  return {};
}

type TimeCorrectionDialogSessionInput = {
  organizationId: string;
  entry: TimeEntry | undefined;
  controlledOpen: boolean | undefined;
  onOpenChange: ((open: boolean) => void) | undefined;
  showBanner: ReturnType<typeof useBanner>['showBanner'];
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
  // One operation id per opening: a retry after a lost response replays the
  // saved request instead of reporting a conflict.
  const operationIdRef = useRef<string | null>(null);
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
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- every opening starts from a clean selection while the form options load
    setLoadingOptions(true);
    operationIdRef.current = crypto.randomUUID();
    setLoadedOptions(null);
    setSubmitError(null);
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
        const subjectId = sourcePerson?.employeeRecordId ?? result.options.currentEmployeeRecordId;
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
    operationIdRef,
  };
}

type TimeCorrectionDialogFormInput = {
  organizationId: string;
  entry: TimeEntry | undefined;
  onSubmitted: (() => void) | undefined;
  controlledOpen: boolean | undefined;
  onOpenChange: ((open: boolean) => void) | undefined;
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
};

export function useTimeCorrectionDialogForm({
  organizationId,
  entry,
  onSubmitted,
  controlledOpen,
  onOpenChange,
}: TimeCorrectionDialogFormInput): TimeCorrectionDialogForm {
  const { showBanner } = useBanner();
  const session = useTimeCorrectionDialogSession({
    organizationId,
    entry,
    controlledOpen,
    onOpenChange,
    showBanner,
  });
  const { operationIdRef, ...sessionState } = session;
  const { setOpen, subjectEmployeeRecordId, targetEmployeeRecordId, jobId, setSubmitError } = sessionState;
  const [submitting, setSubmitting] = useState(false);
  const [kind, setKind] = useState<TimeCorrectionKind>(entry ? 'edit' : 'missed_clock');
  const initialStart = toLocalDateTime(entry?.timestamp ?? new Date().toISOString());
  const [startAt, setStartAt] = useState(initialStart);
  const [splitAt, setSplitAt] = useState(oneHourAfter(initialStart));
  const [endAt, setEndAt] = useState(oneHourAfter(initialStart));
  const [reason, setReason] = useState('');
  const [activityKind, setActivityKind] = useState<TimeSegmentKind>(entry?.activityKind ?? 'work');
  const [fieldErrors, setFieldErrors] = useState<TimeCorrectionFieldErrors>({});

  const source = useMemo(() => {
    if (!entry?.sourceKind) return null;
    const id =
      entry.sourceKind === 'canonical_segment'
        ? entry.canonicalSegmentId
        : entry.sourceKind === 'correction_application'
          ? entry.correctionApplicationId
          : entry.id;
    return id ? { kind: entry.sourceKind, id } : null;
  }, [entry]);

  const submit = async () => {
    const nextFieldErrors = {
      person: subjectEmployeeRecordId ? undefined : 'Bitte wähle eine Person aus.',
      ...validateTimeCorrectionTimes({ kind, startAt, splitAt, endAt }),
      reason: reason.trim() ? undefined : 'Bitte gib einen Grund an.',
    };
    setFieldErrors(nextFieldErrors);
    if (
      focusFirstInvalidField({
        'time-correction-person': nextFieldErrors.person,
        'time-correction-start-date': nextFieldErrors.startAt,
        'time-correction-split-date': nextFieldErrors.splitAt,
        'time-correction-end-date': nextFieldErrors.endAt,
        'time-correction-reason': nextFieldErrors.reason,
      })
    ) {
      return;
    }
    const baseEmployeeRecordId = kind === 'reassign' ? targetEmployeeRecordId : subjectEmployeeRecordId;
    const proposedFacts = buildTimeCorrectionProposedFacts({
      kind,
      entry,
      baseEmployeeRecordId,
      jobId,
      activityKind,
      startAt,
      splitAt,
      endAt,
    });

    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await submitTimeCorrection({
        organizationId,
        subjectEmployeeRecordId,
        kind,
        reason,
        source: kind === 'add' || kind === 'missed_clock' ? null : source,
        proposedFacts,
        operationId: (operationIdRef.current ??= crypto.randomUUID()),
      });
      if (!result.success) {
        setSubmitError(
          describeFailure(
            result.error,
            TIME_CORRECTION_FAILURE_MESSAGES,
            'Die Korrektur konnte nicht gespeichert werden.',
          ),
        );
        return;
      }
      showBanner({
        variant: 'success',
        message:
          result.status === 'approved'
            ? 'Die Zeit wurde korrigiert.'
            : 'Die Korrektur wurde zur Prüfung eingereicht.',
      });
      setOpen(false);
      setReason('');
      onSubmitted?.();
    } catch {
      setSubmitError('Die Korrektur konnte nicht gespeichert werden.');
    } finally {
      setSubmitting(false);
    }
  };

  return {
    ...sessionState,
    submitting,
    submit,
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
  };
}
