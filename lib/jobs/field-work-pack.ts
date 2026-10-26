import { formatSiteAddress, type ClientContact, type ClientSite } from '@/lib/clients/types';
import type {
  Client,
  JobInstructionActor,
  JobInstructionItemWithDetails,
  JobWithDetails,
} from '@/lib/jobs/types';
import { isTerminalWorkExecutionState, type WorkExecutionState } from '@/lib/work-lifecycle/types';

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

// The field projections below are allow-lists: every field is named, so a new
// office-only field stays out of an employee's read until someone adds it here.

/** The customer as an assigned employee sees it: name and phone, never the customer record. */
export function projectFieldClient(client: Client): Client {
  return {
    id: client.id,
    organizationId: client.organizationId,
    name: client.name,
    clientType: client.clientType,
    customerNumber: null,
    email: null,
    phone: client.phone,
    address: null,
    notes: null,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}

function projectFieldSite(site: ClientSite): ClientSite {
  return {
    id: site.id,
    organizationId: site.organizationId,
    clientId: site.clientId,
    name: site.name,
    street: site.street,
    postalCode: site.postalCode,
    city: site.city,
    accessNotes: site.accessNotes,
    notes: null,
    primaryContactId: null,
    isPrimary: site.isPrimary,
    isActive: site.isActive,
    createdBy: null,
    createdAt: site.createdAt,
    updatedAt: site.updatedAt,
  };
}

function projectFieldContact(contact: ClientContact): ClientContact {
  return {
    id: contact.id,
    organizationId: contact.organizationId,
    clientId: contact.clientId,
    name: contact.name,
    role: contact.role,
    email: null,
    phone: contact.phone,
    notes: null,
    isPrimary: contact.isPrimary,
    isActive: contact.isActive,
    createdBy: null,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
  };
}

/** An assigned employee's read of their own job: the job, and only the field facts of its customer, site, contact and team. */
export function projectFieldJobDetails(job: JobWithDetails): JobWithDetails {
  return {
    id: job.id,
    organizationId: job.organizationId,
    projectId: job.projectId,
    clientId: job.clientId,
    jobNumber: job.jobNumber,
    title: job.title,
    description: job.description,
    status: job.status,
    executionState: job.executionState,
    executionVersion: job.executionVersion,
    priority: job.priority,
    plannedDate: job.plannedDate,
    plannedTime: job.plannedTime,
    estimatedDurationMinutes: job.estimatedDurationMinutes,
    plannedWorkingMinutes: job.plannedWorkingMinutes,
    actualCompletionDate: job.actualCompletionDate,
    location: job.location,
    siteId: job.siteId,
    contactId: job.contactId,
    createdBy: job.createdBy,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    assignments: job.assignments.map((assignment) => ({
      id: assignment.id,
      jobId: assignment.jobId,
      userId: assignment.userId,
      assignedBy: assignment.assignedBy,
      assignedAt: assignment.assignedAt,
      firstName: assignment.firstName,
      lastName: assignment.lastName,
      email: null,
      avatarPath: null,
    })),
    client: job.client ? projectFieldClient(job.client) : null,
    project: job.project,
    site: job.site ? projectFieldSite(job.site) : null,
    contact: job.contact ? projectFieldContact(job.contact) : null,
    scheduledVisitCount: job.scheduledVisitCount ?? 0,
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
  items: JobInstructionItemWithDetails[],
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
