import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import {
  ensureClientManagerAccess,
  ensureEmployeeManagerAccess,
  ensureEquipmentManagerAccess,
  ensureJobAccess,
  ensureMaintenanceCoverageManagerAccess,
  ensureProjectManagerAccess,
  ensureServiceCaseManagerAccess,
  getAuthorizedDocument,
  requireManager,
  type AuthorizedDocumentContext,
} from './access';
import { documentWriteFailure, revalidateDocuments } from './write-support';

/** A target the link dialogs attach a document to. Requests receive documents only at upload. */
export type DocumentLinkTarget =
  | { kind: 'job'; jobId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'client'; clientId: string }
  | { kind: 'employee'; employeeId: string }
  | { kind: 'equipment'; equipmentId: string }
  | { kind: 'service_case'; serviceCaseId: string }
  | { kind: 'maintenance_coverage'; maintenanceCoverageId: string };

/** The one target an attach request names, or null when it names none or several. */
export function singleLinkTarget(input: {
  jobId?: string | undefined;
  projectId?: string | undefined;
  clientId?: string | undefined;
  employeeId?: string | undefined;
  equipmentId?: string | undefined;
  serviceCaseId?: string | undefined;
  maintenanceCoverageId?: string | undefined;
}): DocumentLinkTarget | null {
  const targets: DocumentLinkTarget[] = [
    ...(input.jobId ? [{ kind: 'job' as const, jobId: input.jobId }] : []),
    ...(input.projectId ? [{ kind: 'project' as const, projectId: input.projectId }] : []),
    ...(input.clientId ? [{ kind: 'client' as const, clientId: input.clientId }] : []),
    ...(input.employeeId ? [{ kind: 'employee' as const, employeeId: input.employeeId }] : []),
    ...(input.equipmentId ? [{ kind: 'equipment' as const, equipmentId: input.equipmentId }] : []),
    ...(input.serviceCaseId ? [{ kind: 'service_case' as const, serviceCaseId: input.serviceCaseId }] : []),
    ...(input.maintenanceCoverageId
      ? [{ kind: 'maintenance_coverage' as const, maintenanceCoverageId: input.maintenanceCoverageId }]
      : []),
  ];
  const [target] = targets;
  return targets.length === 1 && target ? target : null;
}

/** The access check of one link target for a manager. */
function authorizeLinkTarget(
  context: AuthorizedDocumentContext,
  target: DocumentLinkTarget,
): Promise<ActionResult> {
  switch (target.kind) {
    case 'job':
      return ensureJobAccess(context, target.jobId);
    case 'project':
      return ensureProjectManagerAccess(context, target.projectId);
    case 'client':
      return ensureClientManagerAccess(context, target.clientId);
    case 'employee':
      return ensureEmployeeManagerAccess(context, target.employeeId);
    case 'equipment':
      return ensureEquipmentManagerAccess(context, target.equipmentId);
    case 'service_case':
      return ensureServiceCaseManagerAccess(context, target.serviceCaseId);
    case 'maintenance_coverage':
      return ensureMaintenanceCoverageManagerAccess(context, target.maintenanceCoverageId);
    default: {
      const exhaustiveTarget: never = target;
      return exhaustiveTarget;
    }
  }
}

/** The id of the record a link target names. */
function linkTargetId(target: DocumentLinkTarget): string {
  switch (target.kind) {
    case 'job':
      return target.jobId;
    case 'project':
      return target.projectId;
    case 'client':
      return target.clientId;
    case 'employee':
      return target.employeeId;
    case 'equipment':
      return target.equipmentId;
    case 'service_case':
      return target.serviceCaseId;
    case 'maintenance_coverage':
      return target.maintenanceCoverageId;
    default: {
      const exhaustiveTarget: never = target;
      return exhaustiveTarget;
    }
  }
}

const idsOf = (targets: readonly DocumentLinkTarget[], kind: DocumentLinkTarget['kind']): string[] =>
  targets.filter((target) => target.kind === kind).map(linkTargetId);

/**
 * Removes and adds links of one document for a manager. Every added target is
 * authorized first; then update_document_links writes the links and their
 * audit events in one transaction, all or nothing. An existing link counts as
 * added without a second audit event.
 */
export async function writeDocumentLinks(
  context: AuthorizedDocumentContext,
  documentId: string,
  change: { removeLinkIds: readonly string[]; additions: readonly DocumentLinkTarget[]; fallback: string },
): Promise<ActionResult<{ addedCount: number; removedCount: number }>> {
  const manager = requireManager(context);
  if (!manager.success) return manager;
  for (const target of change.additions) {
    const access = await authorizeLinkTarget(context, target);
    if (!access.success) return access;
  }
  const { data, error } = await context.admin.rpc('update_document_links', {
    p_actor_id: context.userId,
    p_organization_id: context.orgId,
    p_document_id: documentId,
    p_remove_link_ids: [...change.removeLinkIds],
    p_add_job_ids: idsOf(change.additions, 'job'),
    p_add_project_ids: idsOf(change.additions, 'project'),
    p_add_client_ids: idsOf(change.additions, 'client'),
    p_add_employee_ids: idsOf(change.additions, 'employee'),
    p_add_equipment_ids: idsOf(change.additions, 'equipment'),
    p_add_service_case_ids: idsOf(change.additions, 'service_case'),
    p_add_maintenance_coverage_ids: idsOf(change.additions, 'maintenance_coverage'),
  });
  const [counts] = data ?? [];
  if (error || !counts) {
    return documentWriteFailure(
      'Failed to update document links',
      error,
      ['document_not_found', 'link_not_found', 'not_authorized'],
      change.fallback,
    );
  }
  revalidateDocuments();
  return { success: true, addedCount: counts.added_count, removedCount: counts.removed_count };
}

/** Links one document to one target for a manager, with its audit event. */
export async function linkDocumentToTarget(
  context: AuthorizedDocumentContext,
  documentId: string,
  target: DocumentLinkTarget,
): Promise<ActionResult> {
  const document = await getAuthorizedDocument(context, documentId);
  if (!document.success) return document;
  return writeDocumentLinks(context, documentId, {
    removeLinkIds: [],
    additions: [target],
    fallback: 'link_failed',
  });
}
