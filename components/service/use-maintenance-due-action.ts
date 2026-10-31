'use client';

import { useRef, useState, type Dispatch, type SetStateAction } from 'react';

import { useClientRead, type ReadFailure } from '@/hooks/use-client-read';
import { useServerAction } from '@/hooks/use-server-action';
import { readInBackground } from '@/lib/data/background-read-client';
import type {
  MaintenanceDueItem,
  MaintenanceEvidenceOption,
  MaintenanceScopeOutcome,
} from '@/lib/maintenance/types';
import { formatBerlinLocalDate } from '@/lib/date-time/berlin';
import { formatMinutesAsHoursInput } from '@/lib/jobs/planned-working';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import {
  MAINTENANCE_DUE_REQUIRED_FIELD_IDS,
  dueActionErrorMessage,
  missingDueActionFields,
  runMaintenanceDueAction,
  type MaintenanceDueActionKind,
  type MaintenanceDueActionValues,
  type MaintenanceDueRequiredField,
} from './maintenance-due-action-state';

const NO_EVIDENCE: MaintenanceEvidenceOption[] = [];

type UseMaintenanceDueActionOptions = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  due: MaintenanceDueItem;
  defaultAction: MaintenanceDueActionKind;
  plannedDurationMinutes: number;
  onSaved: (() => void) | undefined;
};

export type MaintenanceDueActionController = MaintenanceDueActionValues & {
  setAction: (action: MaintenanceDueActionKind) => void;
  setReason: (reason: string) => void;
  setDate: (date: string) => void;
  setTime: (time: string) => void;
  setDurationHours: (durationHours: string) => void;
  setScopeOutcome: (scopeOutcome: MaintenanceScopeOutcome) => void;
  setCompletedOn: (completedOn: string) => void;
  setEvidenceIds: Dispatch<SetStateAction<string[]>>;
  setServiceCaseId: (serviceCaseId: string) => void;
  evidence: MaintenanceEvidenceOption[];
  isEvidenceLoading: boolean;
  evidenceFailure: ReadFailure | null;
  error: string | null;
  fieldErrors: Partial<Record<MaintenanceDueRequiredField, string>>;
  isPending: boolean;
  showReason: boolean;
  reasonRequired: boolean;
  submit: () => void;
};

/** The evidence options of the due work's job, read while the dialog is open. */
function useMaintenanceEvidenceRead(open: boolean, jobId: MaintenanceDueItem['jobId']) {
  return useClientRead({
    read: (signal) => readInBackground('maintenance-evidence-options', { jobId: jobId ?? '' }, signal),
    deps: [jobId],
    enabled: open && Boolean(jobId),
    failureMessage: 'Die Arbeitsnachweise konnten nicht geladen werden.',
  });
}

/** Collected values, the evidence read and the submit of the due-work action dialog. */
export function useMaintenanceDueAction({
  open,
  onOpenChange,
  due,
  defaultAction,
  plannedDurationMinutes,
  onSaved,
}: UseMaintenanceDueActionOptions): MaintenanceDueActionController {
  const [action, setAction] = useState<MaintenanceDueActionKind>(defaultAction);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(due.dueDate);
  const [time, setTime] = useState('08:00');
  const [durationHours, setDurationHours] = useState(formatMinutesAsHoursInput(plannedDurationMinutes));
  const [scopeOutcome, setScopeOutcome] = useState<MaintenanceScopeOutcome>('complete');
  const [completedOn, setCompletedOn] = useState(formatBerlinLocalDate(new Date()));
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [serviceCaseId, setServiceCaseId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const jobId = due.jobId;
  const evidenceRead = useMaintenanceEvidenceRead(open, jobId);
  const values: MaintenanceDueActionValues = {
    action,
    reason,
    date,
    time,
    durationHours,
    scopeOutcome,
    completedOn,
    evidenceIds,
    serviceCaseId,
  };
  const { run, isPending } = useServerAction(async () => {
    setError(null);
    const result = await runMaintenanceDueAction(due, values, idempotencyKey.current);
    if (!result.success) {
      setError(dueActionErrorMessage(result.error));
      return;
    }
    onOpenChange(false);
    // Without a caller's live read, the action's response renders the route.
    onSaved?.();
  });
  // The reason field is hidden for schedule, so it must never count as missing there.
  const showReason = action !== 'schedule';
  const reasonRequired = showReason && action !== 'create_visit' && action !== 'complete';
  const missingFields = missingDueActionFields(values, reasonRequired);
  const fieldErrors = attempted ? missingFields : {};

  function submit(): void {
    setError(null);
    setAttempted(true);
    const errorsById = Object.fromEntries(
      MAINTENANCE_DUE_REQUIRED_FIELD_IDS.map(([key, id]) => [id, missingFields[key]]),
    );
    if (focusFirstInvalidField(errorsById)) return;
    void run();
  }

  return {
    ...values,
    setAction,
    setReason,
    setDate,
    setTime,
    setDurationHours,
    setScopeOutcome,
    setCompletedOn,
    setEvidenceIds,
    setServiceCaseId,
    evidence: evidenceRead.data?.options ?? NO_EVIDENCE,
    // Without a job no evidence can load, so completing stays held as before the read.
    isEvidenceLoading: !jobId || evidenceRead.loading,
    evidenceFailure: evidenceRead.failure,
    error,
    fieldErrors,
    isPending,
    showReason,
    reasonRequired,
    submit,
  };
}
