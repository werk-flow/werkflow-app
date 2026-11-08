'use client';

import { Button } from '@/components/ui/button';
import { useReportPending } from '@/hooks/use-report-pending';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { useBanner } from '@/components/ui/banner';
import { describeFailure } from '@/lib/action-messages';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { createProject, type CreateProjectInput } from '@/lib/projects/actions';
import { type Job, type Project } from '@/lib/jobs/types';
import type { ClientSelectItem } from '../shared/client-select-with-create';
import { toLocalDateString } from '@/lib/utils';
import { CreateProjectFormFields } from './create-project-form-fields';
import { useCreateProjectForm, type CreateProjectForm } from './use-create-project-form';
import {
  CREATE_PROJECT_ERROR_MESSAGES,
  linkJobsToProject,
  projectCreatedBanner,
  type CreateProjectSubmission,
} from './create-project-submission';

export interface CreateProjectFormContentProps {
  /** The customer a new project starts with, as the page shows it. */
  defaultClient?: ClientSelectItem | undefined;
  jobs: Job[];
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

/** The required-field errors of the create form, keyed by field id. */
function createProjectFieldErrors({ projectNumber, name, description }: CreateProjectForm) {
  return {
    'create-project-number': projectNumber.trim() ? undefined : 'Bitte gib eine Projektnummer ein.',
    'create-project-name':
      name.trim() || description.trim()
        ? undefined
        : 'Bitte gib mindestens einen Titel oder eine Beschreibung ein.',
  };
}

/** The create request of the form's trimmed values; an empty value is left out. */
function buildCreateProjectInput({
  name,
  description,
  templateVersionId,
  clientId,
  siteId,
  contactId,
  projectNumber,
  plannedStartDate,
  plannedEndDate,
}: CreateProjectForm): CreateProjectInput {
  return {
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
}

function useCreateProjectSubmit(
  form: CreateProjectForm,
  onSuccess: CreateProjectFormContentProps['onSuccess'],
  onSubmitDeferred: CreateProjectFormContentProps['onSubmitDeferred'],
) {
  const { showBanner } = useBanner();
  const {
    selectedJobIds,
    runSubmit,
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

    const fieldErrors = createProjectFieldErrors(form);
    setProjectNumberError(fieldErrors['create-project-number'] ?? null);
    setContentError(fieldErrors['create-project-name'] ?? null);
    if (focusFirstInvalidField(fieldErrors)) return;

    const input = buildCreateProjectInput(form);

    if (onSubmitDeferred) {
      onSubmitDeferred({ input, linkedJobIds: selectedJobIds });
      return;
    }

    await runSubmit(async () => {
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
      }
    });
  };

  return handleSubmit;
}

export function CreateProjectFormContent({
  defaultClient,
  jobs,
  readOnlyClient,
  onSuccess,
  onSubmitDeferred,
  isActive = true,
  onPendingChange,
}: CreateProjectFormContentProps) {
  const form = useCreateProjectForm({
    defaultClient,
    jobs,
    readOnlyClient,
    isActive,
  });
  const handleSubmit = useCreateProjectSubmit(form, onSuccess, onSubmitDeferred);
  const { isLoading, error, formDisabled } = form;

  useReportPending(isLoading, onPendingChange);

  return (
    <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="grid gap-4 py-2">
        <CreateProjectFormFields form={form} defaultClient={defaultClient} readOnlyClient={readOnlyClient} />

        <ErrorText>{error}</ErrorText>
      </DialogBody>

      <DialogFooter>
        <Button pending={isLoading} type="submit" disabled={formDisabled}>
          {isLoading ? 'Wird erstellt…' : 'Projekt erstellen'}
        </Button>
      </DialogFooter>
    </form>
  );
}
