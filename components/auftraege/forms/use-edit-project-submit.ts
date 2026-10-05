'use client';

import { useRouter } from 'next/navigation';
import { useBanner } from '@/components/ui/banner';
import { describeFailure } from '@/lib/action-messages';
import { updateProject, type UpdateProjectInput } from '@/lib/projects/actions';
import { updateJob } from '@/lib/jobs/actions';
import type { Project, ProjectWithDetails } from '@/lib/jobs/types';
import { toLocalDateString } from '@/lib/utils';
import { ERROR_MESSAGES, type EditProjectForm } from './use-edit-project-form';

type EditProjectSubmitInput = {
  project: ProjectWithDetails;
  form: EditProjectForm;
  onOpenChange: (open: boolean) => void;
  onSuccess: ((payload: { project: Project; selectedJobIds: string[] }) => void | Promise<void>) | undefined;
};

/** Saves the edit-project draft, then links and unlinks the jobs whose selection changed. */
export function useEditProjectSubmit({ project, form, onOpenChange, onSuccess }: EditProjectSubmitInput) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const {
    name,
    description,
    clientId,
    siteId,
    contactId,
    projectNumber,
    plannedStartDate,
    plannedEndDate,
    selectedJobIds,
    originalJobIds,
    runSubmit,
    setError,
    setContentError,
    setHasAttemptedSubmit,
  } = form;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setError(null);
    setContentError(null);

    if (!name.trim() && !description.trim()) {
      setContentError('Bitte gib mindestens einen Titel oder eine Beschreibung ein.');
      return;
    }

    await runSubmit(async () => {
      try {
        // A field is sent when it differs from the project, an empty string
        // included: the action stores '' as null, so clearing a description,
        // customer, number or date is an update, not an omission.
        const nextDescription = description.trim();
        const nextClientId = clientId && clientId !== 'none' ? clientId : '';
        const nextProjectNumber = projectNumber.trim();
        const nextPlannedStartDate = plannedStartDate ? toLocalDateString(plannedStartDate) : '';
        const nextPlannedEndDate = plannedEndDate ? toLocalDateString(plannedEndDate) : '';
        const input: UpdateProjectInput = {
          name: name.trim(),
          siteId,
          contactId,
          ...(nextDescription !== (project.description ?? '') ? { description: nextDescription } : {}),
          ...(nextClientId !== (project.clientId ?? '') ? { clientId: nextClientId } : {}),
          ...(nextProjectNumber !== (project.projectNumber ?? '')
            ? { projectNumber: nextProjectNumber }
            : {}),
          ...(nextPlannedStartDate !== (project.plannedStartDate ?? '')
            ? { plannedStartDate: nextPlannedStartDate }
            : {}),
          ...(nextPlannedEndDate !== (project.plannedEndDate ?? '')
            ? { plannedEndDate: nextPlannedEndDate }
            : {}),
        };

        const result = await updateProject(project.id, input);

        if (!result.success && result.error !== 'no_changes') {
          const message = describeFailure(result.error, ERROR_MESSAGES, 'Unbekannter Fehler');
          if (result.error === 'name_or_description_required') {
            setContentError(message);
          } else {
            setError(message);
          }
          return;
        }

        const toLink = selectedJobIds.filter((id) => !originalJobIds.includes(id));
        const toUnlink = originalJobIds.filter((id) => !selectedJobIds.includes(id));

        let failedAssignmentCount = 0;
        if (toLink.length > 0 || toUnlink.length > 0) {
          const settled = await Promise.allSettled([
            ...toLink.map((jobId) => updateJob(jobId, { projectId: project.id })),
            ...toUnlink.map((jobId) => updateJob(jobId, { projectId: '' })),
          ]);
          failedAssignmentCount = settled.filter(
            (entry) => entry.status === 'rejected' || !entry.value.success,
          ).length;
        }

        onOpenChange(false);
        // A partially failed assignment sync must stay visible (no-silent-failure
        // rule); the project itself is already saved at this point.
        showBanner(
          failedAssignmentCount > 0
            ? {
                variant: 'error',
                message:
                  failedAssignmentCount === 1
                    ? 'Projekt gespeichert, aber eine Auftragszuordnung konnte nicht aktualisiert werden. Bitte prüfe die Auftragsliste.'
                    : `Projekt gespeichert, aber ${failedAssignmentCount} Auftragszuordnungen konnten nicht aktualisiert werden. Bitte prüfe die Auftragsliste.`,
              }
            : { variant: 'success', message: 'Projekt gespeichert.' },
        );
        if (onSuccess) {
          await onSuccess({
            project: result.success ? result.project : project,
            selectedJobIds,
          });
        } else {
          router.refresh();
        }
      } catch {
        setError('Ein unerwarteter Fehler ist aufgetreten.');
      }
    });
  };

  return { handleSubmit };
}
