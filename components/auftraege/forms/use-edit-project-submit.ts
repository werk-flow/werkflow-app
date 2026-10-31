'use client';

import { useBanner, type BannerVariant } from '@/components/ui/banner';
import { describeFailure } from '@/lib/action-messages';
import { updateProject, type UpdateProjectInput } from '@/lib/projects/actions';
import { updateJob } from '@/lib/jobs/actions';
import type { Project, ProjectWithDetails } from '@/lib/jobs/types';
import { toLocalDateString } from '@/lib/utils';
import { ERROR_MESSAGES, type EditProjectForm } from './use-edit-project-form';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

const CONTENT_REQUIRED_MESSAGE = 'Bitte gib mindestens einen Titel oder eine Beschreibung ein.';

type EditProjectSubmitInput = {
  project: ProjectWithDetails;
  form: EditProjectForm;
  onOpenChange: (open: boolean) => void;
  onSuccess: ((payload: { project: Project; selectedJobIds?: string[] }) => void | Promise<void>) | undefined;
};

/** Saves the edit-project draft, then links and unlinks the jobs whose selection changed. */
export function useEditProjectSubmit({ project, form, onOpenChange, onSuccess }: EditProjectSubmitInput) {
  const { showBanner } = useBanner();
  const {
    name,
    description,
    selectedJobIds,
    originalJobIds,
    jobsFailure,
    isLoadingJobs,
    runSubmit,
    setError,
    setContentError,
    setHasAttemptedSubmit,
  } = form;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setError(null);
    const contentError = name.trim() || description.trim() ? undefined : CONTENT_REQUIRED_MESSAGE;
    setContentError(contentError ?? null);
    if (focusFirstInvalidField({ 'edit-project-name': contentError })) return;

    await runSubmit(async () => {
      try {
        const result = await updateProject(project.id, editProjectUpdateInput(project, form));

        if (!result.success && result.error !== 'no_changes') {
          const message = describeFailure(result.error, ERROR_MESSAGES, 'Unbekannter Fehler');
          if (result.error === 'name_or_description_required') {
            setContentError(message);
          } else {
            setError(message);
          }
          return;
        }

        // Without the loaded jobs the selection is unknown, not empty: the save keeps every link as it is.
        const jobsKnown = !isLoadingJobs && jobsFailure === null;
        const toLink = jobsKnown ? selectedJobIds.filter((id) => !originalJobIds.includes(id)) : [];
        const toUnlink = jobsKnown ? originalJobIds.filter((id) => !selectedJobIds.includes(id)) : [];
        const failedAssignmentCount = await syncProjectJobLinks(project.id, toLink, toUnlink);

        onOpenChange(false);
        // A partially failed assignment sync must stay visible (no-silent-failure
        // rule); the project itself is already saved at this point.
        showBanner(projectSavedBanner(failedAssignmentCount));
        // updateProject's and updateJob's responses render the route; 'no_changes' changed nothing.
        const savedProject = result.success ? result.project : project;
        await onSuccess?.(jobsKnown ? { project: savedProject, selectedJobIds } : { project: savedProject });
      } catch {
        setError('Ein unerwarteter Fehler ist aufgetreten.');
      }
    });
  };

  return { handleSubmit };
}

/**
 * The update of the draft against the project. A field is sent when it
 * differs from the project, an empty string included: the action stores ''
 * as null, so clearing a description, customer, number or date is an update,
 * not an omission.
 */
function editProjectUpdateInput(project: ProjectWithDetails, form: EditProjectForm): UpdateProjectInput {
  const { name, description, clientId, siteId, contactId, projectNumber, plannedStartDate, plannedEndDate } =
    form;
  const nextDescription = description.trim();
  const nextClientId = clientId && clientId !== 'none' ? clientId : '';
  const nextProjectNumber = projectNumber.trim();
  const nextPlannedStartDate = plannedStartDate ? toLocalDateString(plannedStartDate) : '';
  const nextPlannedEndDate = plannedEndDate ? toLocalDateString(plannedEndDate) : '';
  return {
    name: name.trim(),
    siteId,
    contactId,
    ...(nextDescription !== (project.description ?? '') ? { description: nextDescription } : {}),
    ...(nextClientId !== (project.clientId ?? '') ? { clientId: nextClientId } : {}),
    ...(nextProjectNumber !== (project.projectNumber ?? '') ? { projectNumber: nextProjectNumber } : {}),
    ...(nextPlannedStartDate !== (project.plannedStartDate ?? '')
      ? { plannedStartDate: nextPlannedStartDate }
      : {}),
    ...(nextPlannedEndDate !== (project.plannedEndDate ?? '') ? { plannedEndDate: nextPlannedEndDate } : {}),
  };
}

/** Links and unlinks the jobs whose selection changed; resolves to the number of failed updates. */
async function syncProjectJobLinks(projectId: string, toLink: string[], toUnlink: string[]): Promise<number> {
  if (toLink.length === 0 && toUnlink.length === 0) return 0;
  const settled = await Promise.allSettled([
    ...toLink.map((jobId) => updateJob(jobId, { projectId })),
    ...toUnlink.map((jobId) => updateJob(jobId, { projectId: '' })),
  ]);
  return settled.filter((entry) => entry.status === 'rejected' || !entry.value.success).length;
}

/** The confirmation after a save: an error banner when any job link failed to update. */
function projectSavedBanner(failedAssignmentCount: number): { variant: BannerVariant; message: string } {
  if (failedAssignmentCount === 0) return { variant: 'success', message: 'Projekt gespeichert.' };
  return {
    variant: 'error',
    message:
      failedAssignmentCount === 1
        ? 'Projekt gespeichert, aber eine Auftragszuordnung konnte nicht aktualisiert werden. Bitte prüfe die Auftragsliste.'
        : `Projekt gespeichert, aber ${failedAssignmentCount} Auftragszuordnungen konnten nicht aktualisiert werden. Bitte prüfe die Auftragsliste.`,
  };
}
