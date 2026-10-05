'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { createJob } from '@/lib/jobs/actions';
import type { AssignmentApproval, AssignmentEvaluation } from '@/lib/qualifications/types';
import type { CreateJobFormContentProps } from './create-job-form-content';
import {
  CREATE_JOB_ERROR_MESSAGES,
  buildCreateJobInput,
  type CreateJobFormValues,
} from './create-job-submission';

type CreateJobSubmitOptions = {
  values: CreateJobFormValues;
  /** The project's defaults are still loading or failed to load. */
  isBlocked: boolean;
  /** The form-level error line. */
  setError: (error: string | null) => void;
  onSuccess: CreateJobFormContentProps['onSuccess'];
  onSubmitDeferred: CreateJobFormContentProps['onSubmitDeferred'];
};

/** Validation, the create call (or the deferred hand-over) and the field errors it reports. */
export function useCreateJobSubmit({
  values,
  isBlocked,
  setError,
  onSuccess,
  onSubmitDeferred,
}: CreateJobSubmitOptions) {
  const { jobNumber, title, description, selectedEmployees } = values;
  const [qualificationWarning, setQualificationWarning] = useState<AssignmentEvaluation | null>(null);
  const { run: runSubmit, isPending: isLoading } = usePendingTask();
  const [contentError, setContentError] = useState<string | null>(null);
  const [jobNumberError, setJobNumberError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const { showBanner } = useBanner();

  const submitJob = async (approval?: AssignmentApproval) => {
    if (isBlocked) return;
    setHasAttemptedSubmit(true);
    setError(null);
    setContentError(null);
    setJobNumberError(null);

    let hasValidationError = false;
    if (!jobNumber.trim()) {
      setJobNumberError('Bitte gib eine Auftragsnummer ein.');
      hasValidationError = true;
    }
    if (!title.trim() && !description.trim()) {
      setContentError('Bitte gib mindestens einen Titel oder eine Beschreibung ein.');
      hasValidationError = true;
    }
    if (hasValidationError) {
      document.getElementById(!jobNumber.trim() ? 'job-number' : 'job-title')?.focus();
      return;
    }

    const input = buildCreateJobInput(values, approval);

    if (onSubmitDeferred) {
      onSubmitDeferred({ input, assignedUserIds: selectedEmployees });
      return;
    }

    await runSubmit(async () => {
      try {
        const result = await createJob(input);

        if (!result.success) {
          if (
            (result.error === 'qualification_warning' || result.error === 'stale_evaluation') &&
            'evaluation' in result
          ) {
            setQualificationWarning(result.evaluation);
            return;
          }
          const message = describeFailure(result.error, CREATE_JOB_ERROR_MESSAGES, 'Unbekannter Fehler');
          if (result.error === 'job_number_required' || result.error === 'job_number_taken') {
            setJobNumberError(message);
          } else if (result.error === 'title_or_description_required') {
            setContentError(message);
          } else {
            setError(message);
          }
          return;
        }

        setQualificationWarning(null);
        showBanner({ variant: 'success', message: 'Auftrag erfolgreich erstellt!' });
        await onSuccess?.({
          job: result.job,
          assignedUserIds: selectedEmployees,
        });
      } catch {
        setError('Ein unerwarteter Fehler ist aufgetreten.');
      }
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitJob();
  };

  const showContentError = hasAttemptedSubmit && contentError;
  const showJobNumberError = hasAttemptedSubmit && jobNumberError;

  return {
    qualificationWarning,
    setQualificationWarning,
    isLoading,
    contentError,
    setContentError,
    jobNumberError,
    setJobNumberError,
    showContentError,
    showJobNumberError,
    submitJob,
    handleSubmit,
  };
}
