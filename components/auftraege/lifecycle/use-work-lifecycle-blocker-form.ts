'use client';

import { useState, type FormEvent } from 'react';

import { usePendingTask } from '@/hooks/use-server-action';
import { parkWorkTarget, saveWorkBlocker } from '@/lib/work-lifecycle/actions';
import type { WorkBlocker, WorkBlockerReason, WorkLifecycleSnapshot } from '@/lib/work-lifecycle/types';
import { workLifecycleErrorMessage } from './work-lifecycle-messages';
import { parseIsoLocalDate, toLocalDateString } from '@/lib/utils';

export type WorkBlockerDialogProps = {
  snapshot: WorkLifecycleSnapshot;
  kind: 'blocker' | 'parking';
  blocker?: WorkBlocker | undefined;
  isManager: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
};

type WorkLifecycleBlockerForm = {
  reason: WorkBlockerReason;
  setReason: (reason: WorkBlockerReason) => void;
  details: string;
  setDetails: (details: string) => void;
  ownerId: string;
  setOwnerId: (ownerId: string) => void;
  reviewDate: Date | undefined;
  setReviewDate: (reviewDate: Date | undefined) => void;
  error: string | null;
  pending: boolean;
  submit: (event: FormEvent) => void;
};

/** State, validation and save of the blocker and parking dialog. */
export function useWorkLifecycleBlockerForm({
  snapshot,
  kind,
  blocker,
  isManager,
  onClose,
  onChanged,
}: WorkBlockerDialogProps): WorkLifecycleBlockerForm {
  const [reason, setReason] = useState<WorkBlockerReason>(blocker?.reason ?? 'other');
  const [details, setDetails] = useState(blocker?.details ?? '');
  const [ownerId, setOwnerId] = useState(
    blocker?.responsible_employee_record_id ?? (isManager ? '' : (snapshot.ownOwnerId ?? '')),
  );
  const savedReviewDate = blocker?.next_review_date ? parseIsoLocalDate(blocker.next_review_date) : undefined;
  const [reviewDate, setReviewDate] = useState(isManager ? savedReviewDate : new Date());
  const [error, setError] = useState<string | null>(null);
  const { run: runBlockerTask, isPending: pending } = usePendingTask();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ownerId || !reviewDate || (reason === 'other' && details.trim().length < 3)) {
      const detailsMissing = reason === 'other' && details.trim().length < 3;
      setError(
        detailsMissing
          ? 'Beschreibe den Grund unter Details.'
          : 'Grund, verantwortliche Person und Wiedervorlage sind erforderlich.',
      );
      document
        .getElementById(
          detailsMissing ? 'work-blocker-details' : !ownerId ? 'work-blocker-owner' : 'work-blocker-review',
        )
        ?.focus();
      return;
    }
    void runBlockerTask(async () => {
      const input = {
        targetType: snapshot.targetType,
        targetId: snapshot.targetId,
        reason,
        ...(details.trim() ? { details: details.trim() } : {}),
        responsibleEmployeeRecordId: ownerId,
        nextReviewDate: toLocalDateString(reviewDate),
      };
      const result =
        kind === 'parking'
          ? await parkWorkTarget({
              ...input,
              expectedExecutionVersion: snapshot.executionVersion,
            })
          : await saveWorkBlocker({
              ...input,
              ...(blocker ? { blockerId: blocker.id, expectedVersion: blocker.version } : {}),
            });
      if (!result.success) {
        setError(workLifecycleErrorMessage(result.error));
        return;
      }
      await onChanged();
      onClose();
    });
  };
  return {
    reason,
    setReason,
    details,
    setDetails,
    ownerId,
    setOwnerId,
    reviewDate,
    setReviewDate,
    error,
    pending,
    submit,
  };
}
