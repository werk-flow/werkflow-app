'use client';

import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useReportPending } from '@/hooks/use-report-pending';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { useBanner } from '@/components/ui/banner';
import { describeFailure } from '@/lib/action-messages';
import { createProject, type CreateProjectInput } from '@/lib/projects/actions';
import { updateJob } from '@/lib/jobs/actions';
import { type Client, type Job, type Project } from '@/lib/jobs/types';
import { toLocalDateString } from '@/lib/utils';
import { CreateProjectFormFields } from './create-project-form-fields';
import { useCreateProjectForm, type CreateProjectForm } from './use-create-project-form';

export const CREATE_PROJECT_ERROR_MESSAGES = {
  not_authorized: 'Du bist nicht berechtigt, Projekte zu verwalten.',
  name_or_description_required: 'Bitte gib mindestens einen Titel oder eine Beschreibung ein.',
  project_number_required: 'Bitte gib eine Projektnummer ein.',
  project_number_taken: 'Diese Projektnummer ist bereits vergeben.',
  client_not_found: 'Kunde nicht gefunden.',
  create_failed: 'Fehler beim Erstellen des Projekts.',
  work_template_version_unavailable: 'Die gewählte Arbeitsvorlage ist nicht mehr verfügbar.',
  work_template_reference_unavailable: 'Die Arbeitsvorlage verweist auf nicht mehr aktive Stammdaten.',
  template_apply_failed: 'Die Arbeitsvorlage konnte nicht übernommen werden.',
} satisfies Record<string, string>;

/** A validated create request the landing list runs itself (deferred submit). */
export type CreateProjectSubmission = {
  input: CreateProjectInput;
  linkedJobIds: string[];
};

/** Links the selected jobs to the new project; returns how many links failed. */
export async function linkJobsToProject(projectId: string, jobIds: string[]): Promise<number> {
  if (jobIds.length === 0) return 0;
  const linkResults = await Promise.allSettled(jobIds.map((jobId) => updateJob(jobId, { projectId })));
  return linkResults.filter(
    (entry) => entry.status === 'rejected' || (entry.status === 'fulfilled' && !entry.value.success),
  ).length;
}

// Partially failed job links must stay visible (no-silent-failure rule);
// the project itself exists at this point.
export function projectCreatedBanner(failedLinkCount: number): {
  variant: 'success' | 'error';
  message: string;
} {
  if (failedLinkCount === 0) {
    return { variant: 'success', message: 'Projekt erfolgreich erstellt!' };
  }
  return {
    variant: 'error',
    message:
      failedLinkCount === 1
        ? 'Projekt erstellt, aber eine Auftragszuordnung konnte nicht gespeichert werden. Bitte prüfe die Auftragsliste.'
        : `Projekt erstellt, aber ${failedLinkCount} Auftragszuordnungen konnten nicht gespeichert werden. Bitte prüfe die Auftragsliste.`,
  };
}

export interface CreateProjectFormContentProps {
  clients: Client[];
  jobs: Job[];
  defaultClientId?: string | undefined;
  readOnlyClient?: boolean | undefined;
  onSuccess?: (payload: { project: Project; linkedJobIds: string[] }) => void | Promise<void>;
  /**
   * Deferred submit (feedback canon, create from a dialog): the form hands the
   * validated input over instead of awaiting the server, so the caller closes
   * the dialog at once, shows a pending row, and owns the result.
   */
  onSubmitDeferred?: ((submission: CreateProjectSubmission) => void) | undefined;
  isActive?: boolean | undefined;
  /** Reports the running create call, so the surrounding dialog stays open until it answers. */
  onPendingChange?: ((pending: boolean) => void) | undefined;
}

function useCreateProjectSubmit(
  form: CreateProjectForm,
  onSuccess: CreateProjectFormContentProps['onSuccess'],
  onSubmitDeferred: CreateProjectFormContentProps['onSubmitDeferred'],
) {
  const { showBanner } = useBanner();
  const {
    name,
    description,
    templateVersionId,
    clientId,
    siteId,
    contactId,
    projectNumber,
    plannedStartDate,
    plannedEndDate,
    selectedJobIds,
    setIsLoading,
    setError,
    setContentError,
    setProjectNumberError,
    setHasAttemptedSubmit,
    resetForm,
  } = form;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setError(null);
    setContentError(null);
    setProjectNumberError(null);

    let hasValidationError = false;
    if (!projectNumber.trim()) {
      setProjectNumberError('Bitte gib eine Projektnummer ein.');
      hasValidationError = true;
    }
    if (!name.trim() && !description.trim()) {
      setContentError('Bitte gib mindestens einen Titel oder eine Beschreibung ein.');
      hasValidationError = true;
    }
    if (hasValidationError) {
      document
        .getElementById(!projectNumber.trim() ? 'create-project-number' : 'create-project-name')
        ?.focus();
      return;
    }

    const input: CreateProjectInput = {
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(clientId ? { clientId } : {}),
      ...(siteId ? { siteId } : {}),
      ...(contactId ? { contactId } : {}),
      ...(projectNumber.trim() ? { projectNumber: projectNumber.trim() } : {}),
      ...(plannedStartDate ? { plannedStartDate: toLocalDateString(plannedStartDate) } : {}),
      ...(plannedEndDate ? { plannedEndDate: toLocalDateString(plannedEndDate) } : {}),
      ...(templateVersionId ? { templateVersionId } : {}),
    };

    if (onSubmitDeferred) {
      onSubmitDeferred({ input, linkedJobIds: selectedJobIds });
      return;
    }

    setIsLoading(true);

    try {
      const result = await createProject(input);

      if (!result.success) {
        const message = describeFailure(result.error, CREATE_PROJECT_ERROR_MESSAGES, 'Unbekannter Fehler');
        if (result.error === 'project_number_required' || result.error === 'project_number_taken') {
          setProjectNumberError(message);
        } else if (result.error === 'name_or_description_required') {
          setContentError(message);
        } else {
          setError(message);
        }
        return;
      }

      const failedLinkCount = await linkJobsToProject(result.project.id, selectedJobIds);
      showBanner(projectCreatedBanner(failedLinkCount));
      resetForm();
      await onSuccess?.({
        project: result.project,
        linkedJobIds: selectedJobIds,
      });
    } catch {
      setError('Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      setIsLoading(false);
    }
  };

  return handleSubmit;
}

export function CreateProjectFormContent({
  clients,
  jobs,
  defaultClientId,
  readOnlyClient,
  onSuccess,
  onSubmitDeferred,
  isActive = true,
  onPendingChange,
}: CreateProjectFormContentProps) {
  const form = useCreateProjectForm({
    clients,
    jobs,
    defaultClientId,
    readOnlyClient,
    isActive,
  });
  const handleSubmit = useCreateProjectSubmit(form, onSuccess, onSubmitDeferred);
  const { isLoading, error, formDisabled } = form;

  useReportPending(isLoading, onPendingChange);

  return (
    <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="grid gap-4 py-2">
        <CreateProjectFormFields form={form} clients={clients} readOnlyClient={readOnlyClient} />

        <ErrorText>{error}</ErrorText>
      </DialogBody>

      <DialogFooter>
        <Button type="submit" disabled={formDisabled}>
          {isLoading && <Loader2 className="size-4 animate-spin" />}
          {isLoading ? 'Wird erstellt…' : 'Projekt erstellen'}
        </Button>
      </DialogFooter>
    </form>
  );
}
