'use client';

import { useRouter } from 'next/navigation';
import { useBanner } from '@/components/ui/banner';
import { describeFailure } from '@/lib/action-messages';
import { updateJob } from '@/lib/jobs/actions';
import type { AssignmentApproval } from '@/lib/qualifications/types';
import type { Job } from '@/lib/jobs/types';
import { buildEditJobInput } from './edit-job-input';
import type { EditJobForm } from './use-edit-job-form';

const ERROR_MESSAGES = {
  not_authorized: 'Du bist nicht berechtigt, Aufträge zu verwalten.',
  title_or_description_required: 'Bitte gib mindestens einen Titel oder eine Beschreibung ein.',
  job_not_found: 'Auftrag nicht gefunden.',
  client_not_found: 'Kunde nicht gefunden.',
  no_changes: 'Keine Änderungen vorgenommen.',
  update_failed: 'Fehler beim Aktualisieren des Auftrags.',
} satisfies Record<string, string>;

type EditJobSubmitInput = {
  job: Job;
  form: EditJobForm;
  onOpenChange: (open: boolean) => void;
  onSuccess: ((payload: { job: Job; selectedEmployeeIds?: string[] }) => void | Promise<void>) | undefined;
};

/** Validates and saves the edit-job draft, including the date-removal and qualification confirmations. */
export function useEditJobSubmit({ job, form, onOpenChange, onSuccess }: EditJobSubmitInput) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const {
    title,
    description,
    plannedDate,
    selectedEmployees,
    setHasAttemptedSubmit,
    setError,
    setContentError,
    setShowAutoParkDialog,
    setIsLoading,
    setConfirmedDateRemovalForWarning,
    setQualificationWarning,
  } = form;

  const submitChanges = async (confirmedDateRemoval = false, approval?: AssignmentApproval) => {
    setHasAttemptedSubmit(true);
    setError(null);
    setContentError(null);

    if (!title.trim() && !description.trim()) {
      setContentError('Bitte gib mindestens einen Titel oder eine Beschreibung ein.');
      return;
    }

    const isRemovingPlannedDate = !!job.plannedDate && !plannedDate;
    if (isRemovingPlannedDate && !confirmedDateRemoval) {
      setShowAutoParkDialog(true);
      return;
    }

    setIsLoading(true);

    try {
      const input = buildEditJobInput(job, form, approval);

      const result = await updateJob(job.id, input);

      if (!result.success && result.error !== 'no_changes') {
        if (
          (result.error === 'qualification_warning' || result.error === 'stale_evaluation') &&
          'evaluation' in result
        ) {
          setConfirmedDateRemovalForWarning(confirmedDateRemoval);
          setQualificationWarning(result.evaluation);
          return;
        }
        setQualificationWarning(null);
        setConfirmedDateRemovalForWarning(false);
        const message = describeFailure(
          result.error,
          ERROR_MESSAGES,
          'Der Auftrag konnte nicht gespeichert werden.',
        );
        if (result.error === 'title_or_description_required') {
          setContentError(message);
        } else {
          setError(message);
        }
        return;
      }

      setQualificationWarning(null);
      setConfirmedDateRemovalForWarning(false);
      onOpenChange(false);
      showBanner({ variant: 'success', message: 'Auftrag gespeichert.' });
      if (onSuccess) {
        await onSuccess({
          job: result.success ? result.job : job,
          selectedEmployeeIds: selectedEmployees,
        });
      } else {
        router.refresh();
      }
    } catch {
      setError('Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitChanges();
  };

  return { submitChanges, handleSubmit };
}
