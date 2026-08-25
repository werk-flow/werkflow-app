import { formatSiteAddress } from '@/lib/clients/types';
import type {
  JobInstructionActor,
  JobInstructionItemWithDetails,
  JobWithDetails,
} from '@/lib/jobs/types';
import {
  isTerminalWorkExecutionState,
  type WorkExecutionState,
} from '@/lib/work-lifecycle/types';

export type FieldWorkPackJob = {
  id: string;
  jobNumber: string | null;
  title: string;
  requestedOutcome: string | null;
  priority: JobWithDetails['priority'];
  plannedDate: string | null;
  plannedTime: string | null;
  plannedWorkingMinutes: number | null;
  customerName: string | null;
  customerPhone: string | null;
  siteName: string | null;
  siteAddress: string | null;
  accessNotes: string | null;
  contactName: string | null;
  contactRole: string | null;
  contactPhone: string | null;
  project: { id: string; name: string; projectNumber: string } | null;
};

function fieldActor(actor: JobInstructionActor | null): JobInstructionActor | null {
  if (!actor) return null;
  return {
    userId: actor.userId,
    firstName: actor.firstName,
    lastName: actor.lastName,
    email: null,
    avatarPath: null,
  };
}

export function projectFieldWorkPackJob(job: JobWithDetails): FieldWorkPackJob {
  const siteAddress = job.site ? formatSiteAddress(job.site) : '';
  return {
    id: job.id,
    jobNumber: job.jobNumber,
    title: job.title,
    requestedOutcome: job.description,
    priority: job.priority,
    plannedDate: job.plannedDate,
    plannedTime: job.plannedTime,
    plannedWorkingMinutes: job.plannedWorkingMinutes,
    customerName: job.client?.name ?? null,
    customerPhone: job.client?.phone ?? null,
    siteName: job.site?.name ?? null,
    siteAddress: siteAddress || job.location || null,
    accessNotes: job.site?.accessNotes ?? null,
    contactName: job.contact?.name ?? null,
    contactRole: job.contact?.role ?? null,
    contactPhone: job.contact?.phone ?? null,
    project: job.project?.projectNumber
      ? {
          id: job.project.id,
          name: job.project.name,
          projectNumber: job.project.projectNumber,
        }
      : null,
  };
}

export function sanitizeFieldInstructionItems(
  items: JobInstructionItemWithDetails[]
): JobInstructionItemWithDetails[] {
  // Keep this allow-list explicit so new office-only fields stay out by default.
  return items.map((item) => ({
    id: item.id,
    organizationId: item.organizationId,
    jobId: item.jobId,
    projectId: item.projectId,
    itemKind: item.itemKind,
    requirementState: item.requirementState,
    groupLabel: item.groupLabel,
    notes: item.notes,
    templateApplicationId: item.templateApplicationId,
    sourceTemplateItemId: item.sourceTemplateItemId,
    content: item.content,
    sortOrder: item.sortOrder,
    isCompleted: item.isCompleted,
    completionVersion: item.completionVersion,
    createdBy: item.createdBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastStatusChangedBy: item.lastStatusChangedBy,
    lastStatusChangedAt: item.lastStatusChangedAt,
    creator: fieldActor(item.creator),
    lastStatusChangedByProfile: fieldActor(item.lastStatusChangedByProfile),
    evidenceRequirements: item.evidenceRequirements,
    predecessors: item.predecessors,
  }));
}

export function isFieldWorkPackReadOnly(state: WorkExecutionState): boolean {
  return isTerminalWorkExecutionState(state);
}
