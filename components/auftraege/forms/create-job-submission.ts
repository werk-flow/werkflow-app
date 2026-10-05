import type { CreateJobInput } from '@/lib/jobs/actions';
import type { JobPriority } from '@/lib/jobs/types';
import { parseHoursInputToMinutes } from '@/lib/jobs/planned-working';
import type { AssignmentApproval } from '@/lib/qualifications/types';
import { toLocalDateString } from '@/lib/utils';

export const CREATE_JOB_ERROR_MESSAGES = {
  not_authorized: 'Du bist nicht berechtigt, Aufträge zu verwalten.',
  title_or_description_required: 'Bitte gib mindestens einen Titel oder eine Beschreibung ein.',
  job_number_required: 'Bitte gib eine Auftragsnummer ein.',
  job_number_taken: 'Diese Auftragsnummer ist bereits vergeben.',
  client_not_found: 'Kunde nicht gefunden.',
  project_not_found: 'Projekt nicht gefunden.',
  create_failed: 'Fehler beim Erstellen des Auftrags.',
  assign_failed: 'Fehler beim Zuweisen des Mitarbeiters.',
  work_template_version_unavailable: 'Die gewählte Arbeitsvorlage ist nicht mehr verfügbar.',
  work_template_reference_unavailable: 'Die Arbeitsvorlage verweist auf nicht mehr aktive Stammdaten.',
  template_apply_failed: 'Die Arbeitsvorlage konnte nicht übernommen werden.',
} satisfies Record<string, string>;

/** A validated create request the landing list runs itself (deferred submit). */
export type CreateJobSubmission = {
  input: CreateJobInput;
  assignedUserIds: string[];
};

export type CreateJobFormValues = {
  title: string;
  description: string;
  clientId: string;
  projectId: string;
  jobNumber: string;
  priority: JobPriority;
  plannedDate: Date | undefined;
  plannedTime: string;
  estimatedHours: string;
  plannedWorkingMinutes: number | null;
  location: string;
  siteId: string;
  contactId: string;
  selectedEmployees: string[];
  assignmentTeamSourceId: string | null;
  templateVersionId: string;
};

/** The server input for the validated form values; empty optional fields are left out. */
export function buildCreateJobInput(
  {
    title,
    description,
    clientId,
    projectId,
    jobNumber,
    priority,
    plannedDate,
    plannedTime,
    estimatedHours,
    plannedWorkingMinutes,
    location,
    siteId,
    contactId,
    selectedEmployees,
    assignmentTeamSourceId,
    templateVersionId,
  }: CreateJobFormValues,
  approval: AssignmentApproval | undefined,
): CreateJobInput {
  const durationMinutes = parseHoursInputToMinutes(estimatedHours);

  return {
    title: title.trim(),
    ...(description.trim() ? { description: description.trim() } : {}),
    ...(clientId ? { clientId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(jobNumber.trim() ? { jobNumber: jobNumber.trim() } : {}),
    priority,
    ...(plannedDate ? { plannedDate: toLocalDateString(plannedDate) } : {}),
    ...(plannedTime ? { plannedTime } : {}),
    ...(durationMinutes !== null && durationMinutes !== undefined
      ? { estimatedDurationMinutes: durationMinutes }
      : {}),
    plannedWorkingMinutes,
    ...(location.trim() ? { location: location.trim() } : {}),
    siteId,
    contactId,
    selectedUserIds: selectedEmployees,
    assignmentApproval: approval ?? null,
    assignmentTeamSourceId,
    ...(templateVersionId ? { templateVersionId } : {}),
  };
}
