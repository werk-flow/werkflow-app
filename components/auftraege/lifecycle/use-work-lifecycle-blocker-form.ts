'use client';

import { useState, type FormEvent } from 'react';

import { usePendingTask } from '@/hooks/use-server-action';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
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
  /** Field errors, shown after the first submit. */
  errors: Partial<WorkBlockerFieldErrors>;
  pending: boolean;
  submit: (event: FormEvent) => void;
};

type WorkBlockerFieldErrors = Record<'details' | 'owner' | 'review', string | undefined>;

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
  const [attempted, setAttempted] = useState(false);
  const { run: runBlockerTask, isPending: pending } = usePendingTask();
  // In visual order; a worker's review date is today.
  const fieldErrors: WorkBlockerFieldErrors = {
    details:
      reason === 'other' && details.trim().length < 3 ? 'Beschreibe den Grund unter Details.' : undefined,
    owner: ownerId ? undefined : 'Bitte wähle eine verantwortliche Person aus.',
    review: reviewDate ? undefined : 'Bitte wähle ein Datum für die Wiedervorlage.',
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    setError(null);
    const invalid = focusFirstInvalidField({
      'work-blocker-details': fieldErrors.details,
      'work-blocker-owner': fieldErrors.owner,
      'work-blocker-review': fieldErrors.review,
    });
    if (invalid || !reviewDate) return;
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
    errors: attempted ? fieldErrors : {},
    pending,
    submit,
  };
}
