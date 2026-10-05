import { describeFailure } from '@/lib/action-messages';
import type { CreateJobInput } from '@/lib/jobs/actions';
import type { Client, Job, ProjectWithDetails } from '@/lib/jobs/types';
import type { CreateProjectInput } from '@/lib/projects/actions';

// Drafts fill the pending row until the server confirms (feedback canon);
// organisation and creator are unknown client-side and never read by the list.
export function buildJobDraft(tempId: string, input: CreateJobInput): Job {
  const now = new Date().toISOString();
  return {
    id: tempId,
    organizationId: '',
    projectId: input.projectId ?? null,
    clientId: input.clientId ?? null,
    jobNumber: input.jobNumber ?? null,
    title: input.title,
    description: input.description ?? null,
    status: 'nicht_bearbeitet',
    executionState: 'not_started',
    executionVersion: 0,
    priority: input.priority ?? 'mittel',
    plannedDate: input.plannedDate ?? null,
    plannedTime: input.plannedTime ?? null,
    estimatedDurationMinutes: input.estimatedDurationMinutes ?? null,
    plannedWorkingMinutes: input.plannedWorkingMinutes ?? null,
    actualCompletionDate: null,
    location: input.location ?? null,
    siteId: input.siteId || null,
    contactId: input.contactId || null,
    createdBy: '',
    createdAt: now,
    updatedAt: now,
  };
}

export function buildProjectDraft(
  tempId: string,
  input: CreateProjectInput,
  clients: Client[],
): ProjectWithDetails {
  const now = new Date().toISOString();
  return {
    id: tempId,
    organizationId: '',
    clientId: input.clientId ?? null,
    name: input.name,
    description: input.description ?? null,
    projectNumber: input.projectNumber ?? null,
    statusOverride: null,
    executionStateOverride: null,
    executionVersion: 0,
    executionOverrideReason: null,
    plannedStartDate: input.plannedStartDate ?? null,
    plannedEndDate: input.plannedEndDate ?? null,
    siteId: input.siteId ?? null,
    contactId: input.contactId ?? null,
    createdBy: '',
    createdAt: now,
    updatedAt: now,
    client: clients.find((client) => client.id === input.clientId) ?? null,
    jobCount: 0,
    completedJobCount: 0,
    inProgressJobCount: 0,
    parkedJobCount: 0,
  };
}

/** Banner copy for a rolled-back create: the known reason, then the outcome. */
export function createFailureMessage(
  areaMessages: Readonly<Partial<Record<string, string>>>,
  error: string,
  notCreated: string,
): string {
  const detail = describeFailure(error, areaMessages, '');
  return detail ? `${detail} ${notCreated}` : notCreated;
}

export const JOB_NOT_CREATED = 'Der Auftrag wurde nicht angelegt.';
export const PROJECT_NOT_CREATED = 'Das Projekt wurde nicht angelegt.';
