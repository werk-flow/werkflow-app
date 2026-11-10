'use client';

import { useState } from 'react';

import { usePlanningWarningConfirmation } from '@/components/kalender/planning-warning-dialog';
import { usePlanningOptions } from '@/hooks/use-planning-options';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { logError } from '@/lib/logging';
import { handOverPersonnelWork } from '@/lib/personnel/handover-actions';
import type { PlanningConflictApproval } from '@/lib/planning/conflict-acknowledgement';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { toLocalDateString } from '@/lib/utils';

import { ERROR_MESSAGES } from './personnel-lifecycle-errors';
import type { PersonnelLifecycleController } from './use-personnel-lifecycle-view';

export type PersonnelLifecycleHandover = ReturnType<typeof usePersonnelLifecycleHandover>;

/** A Berlin calendar date as the date picker's local day. */
function pickerDate(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00`);
}

type HandoverSend = {
  lifecycle: PersonnelLifecycleController;
  targets: Readonly<Record<string, string>>;
  handoverDate: string;
  requestApproval: ReturnType<typeof usePlanningWarningConfirmation>['requestApproval'];
  close: () => void;
};

/** Sends the handover; a capacity warning asks for a reason and sends again with it. */
async function sendHandover(send: HandoverSend, approval: PlanningConflictApproval | null): Promise<void> {
  const { lifecycle, targets } = send;
  const { data } = lifecycle;
  // Only jobs the person still holds; a refresh may have removed one since it was picked.
  const rows = data.transitionInventory.openWork.flatMap((job) => {
    const targetEmployeeRecordId = targets[job.jobId];
    return targetEmployeeRecordId ? [{ jobId: job.jobId, targetEmployeeRecordId }] : [];
  });
  const result = await handOverPersonnelWork({
    employeeRecordId: data.employeeRecordId,
    handoverFrom: send.handoverDate,
    rows,
    planningApproval: approval,
  });
  if (result.success) {
    send.close();
    lifecycle.showBanner({
      variant: 'success',
      message:
        result.data.handedOver === 1
          ? 'Ein Auftrag wurde übergeben.'
          : `${result.data.handedOver} Aufträge wurden übergeben.`,
    });
    lifecycle.reconcileMutation();
    return;
  }
  if ('conflicts' in result) {
    const nextApproval = await send.requestApproval(result.conflicts, result.fingerprint);
    if (nextApproval) await sendHandover(send, nextApproval);
    return;
  }
  lifecycle.setError(lifecycle.failureMessage(result.error));
  // A refused handover may rest on work that changed since the view loaded.
  lifecycle.reconcileMutation();
}

/**
 * The handover dialog: its date, the target per open job, the shared person
 * search, and the save that asks for a reason when the capacity check warns.
 */
export function usePersonnelLifecycleHandover(lifecycle: PersonnelLifecycleController) {
  const { data } = lifecycle;
  const [open, setOpen] = useState(false);
  const [handoverFrom, setHandoverFrom] = useState<Date | undefined>(() => pickerDate(data.handoverFrom));
  const [targets, setTargets] = useState<Record<string, string>>({});
  const selectedTargetIds = [...new Set(Object.values(targets))];
  // One search serves every row's picker; each keeps the labels of its choice.
  const people = usePlanningOptions('employees', selectedTargetIds, [], open);
  const { requestApproval, warningDialog } = usePlanningWarningConfirmation();

  function openHandover(from?: string): void {
    lifecycle.setError(null);
    lifecycle.setFieldErrors({});
    setTargets({});
    // A transition's own date wins, today or later; the server refuses a past one.
    setHandoverFrom(pickerDate(from && from >= getBusinessTodayIso() ? from : data.handoverFrom));
    setOpen(true);
  }

  function setTarget(jobId: string, targetId: string): void {
    setTargets((current) =>
      Object.fromEntries([
        ...Object.entries(current).filter(([knownJobId]) => knownJobId !== jobId),
        ...(targetId ? [[jobId, targetId]] : []),
      ]),
    );
  }

  function setAllTargets(targetId: string, jobIds: readonly string[]): void {
    setTargets(Object.fromEntries(jobIds.map((jobId) => [jobId, targetId])));
  }

  async function submit(): Promise<void> {
    if (lifecycle.mutationDisabled) return;
    lifecycle.setError(null);
    const nextErrors: Record<string, string> = {};
    if (!handoverFrom) nextErrors['handover-from'] = 'Bitte gib ein Datum an.';
    if (!data.transitionInventory.openWork.some((job) => targets[job.jobId])) {
      nextErrors['handover-all'] = 'Wähle für mindestens einen Auftrag, wer ihn übernimmt.';
    }
    lifecycle.setFieldErrors(nextErrors);
    if (focusFirstInvalidField(nextErrors) || !handoverFrom) return;
    const handoverDate = toLocalDateString(handoverFrom);
    try {
      await lifecycle.run(() =>
        sendHandover(
          { lifecycle, targets, handoverDate, requestApproval, close: () => setOpen(false) },
          null,
        ),
      );
    } catch (submitError) {
      logError('Unexpected error handing over open work:', submitError);
      lifecycle.setError(ERROR_MESSAGES.mutation_failed);
    }
  }

  return {
    open,
    setOpen,
    openHandover,
    handoverFrom,
    setHandoverFrom,
    targets,
    setTarget,
    setAllTargets,
    people,
    warningDialog,
    submit,
  };
}
