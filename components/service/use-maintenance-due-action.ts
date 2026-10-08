'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import { useServerAction } from '@/hooks/use-server-action';
import { getMaintenanceEvidenceOptions } from '@/lib/maintenance/actions';
import type {
  MaintenanceDueItem,
  MaintenanceEvidenceOption,
  MaintenanceScopeOutcome,
} from '@/lib/maintenance/types';
import { formatBerlinLocalDate } from '@/lib/planning/date-time';
import { formatMinutesAsHoursInput } from '@/lib/jobs/planned-working';
import {
  MAINTENANCE_DUE_REQUIRED_FIELD_IDS,
  dueActionErrorMessage,
  missingDueActionFields,
  runMaintenanceDueAction,
  type MaintenanceDueActionKind,
  type MaintenanceDueActionValues,
  type MaintenanceDueRequiredField,
} from './maintenance-due-action-state';

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
  evidenceLoadFailed: boolean;
  retryEvidence: () => void;
  error: string | null;
  fieldErrors: Partial<Record<MaintenanceDueRequiredField, string>>;
  isPending: boolean;
  showReason: boolean;
  reasonRequired: boolean;
  submit: () => void;
};

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
  const [evidence, setEvidence] = useState<MaintenanceEvidenceOption[]>([]);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [isEvidenceLoading, setIsEvidenceLoading] = useState(true);
  const [evidenceLoadFailed, setEvidenceLoadFailed] = useState(false);
  const [evidenceReloadCount, setEvidenceReloadCount] = useState(0);
  const [serviceCaseId, setServiceCaseId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!open || !due.jobId) return;
    let current = true;
    void getMaintenanceEvidenceOptions(due.jobId)
      .then((result) => {
        if (!current) return;
        if (result.success) {
          setEvidence(result.options);
        } else {
          setEvidence([]);
          setEvidenceLoadFailed(true);
        }
        setIsEvidenceLoading(false);
      })
      .catch(() => {
        if (!current) return;
        setEvidence([]);
        setEvidenceLoadFailed(true);
        setIsEvidenceLoading(false);
      });
    return () => {
      current = false;
    };
  }, [due.jobId, open, evidenceReloadCount]);

  function retryEvidence(): void {
    setEvidenceLoadFailed(false);
    setIsEvidenceLoading(true);
    setEvidenceReloadCount((count) => count + 1);
  }
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
  const fieldErrors = attempted ? missingDueActionFields(values, reasonRequired) : {};

  function submit(): void {
    setError(null);
    setAttempted(true);
    const errors = missingDueActionFields(values, reasonRequired);
    const firstInvalid = MAINTENANCE_DUE_REQUIRED_FIELD_IDS.find(([key]) => errors[key]);
    if (firstInvalid) {
      document.getElementById(firstInvalid[1])?.focus();
      return;
    }
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
    evidence,
    isEvidenceLoading,
    evidenceLoadFailed,
    retryEvidence,
    error,
    fieldErrors,
    isPending,
    showReason,
    reasonRequired,
    submit,
  };
}
