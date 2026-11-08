import { updateJob } from '@/lib/jobs/actions';
import type { CreateProjectInput } from '@/lib/projects/actions';

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
