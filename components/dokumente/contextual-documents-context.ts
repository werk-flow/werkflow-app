import type { DocumentContextTarget, OrganizationDocument } from '@/lib/documents/types';

/** The one record a contextual document list belongs to; exactly one id is set. */
export type ContextualDocumentLinkContext = {
  jobId?: string | undefined;
  projectId?: string | undefined;
  clientId?: string | undefined;
  employeeId?: string | undefined;
  requestId?: string | undefined;
  equipmentId?: string | undefined;
  serviceCaseId?: string | undefined;
  maintenanceCoverageId?: string | undefined;
};

type ContextualAttachTarget = {
  targetType:
    | 'job'
    | 'project'
    | 'client'
    | 'employee'
    | 'equipment'
    | 'service_case'
    | 'maintenance_coverage';
  targetId: string;
};

export function getContextualDocumentLinkContext(
  documentTarget: DocumentContextTarget,
): ContextualDocumentLinkContext {
  return {
    jobId: documentTarget.kind === 'job' ? documentTarget.jobId : undefined,
    projectId: documentTarget.kind === 'project' ? documentTarget.projectId : undefined,
    clientId: documentTarget.kind === 'client' ? documentTarget.clientId : undefined,
    employeeId: documentTarget.kind === 'employee' ? documentTarget.employeeId : undefined,
    requestId: documentTarget.kind === 'request' ? documentTarget.requestId : undefined,
    equipmentId: documentTarget.kind === 'equipment' ? documentTarget.equipmentId : undefined,
    serviceCaseId: documentTarget.kind === 'service_case' ? documentTarget.serviceCaseId : undefined,
    maintenanceCoverageId:
      documentTarget.kind === 'maintenance_coverage' ? documentTarget.maintenanceCoverageId : undefined,
  };
}

/**
 * The record an existing library document can be attached to from this list.
 * Requests have no attach flow, so a request context yields null.
 */
export function getContextualAttachTarget(
  context: ContextualDocumentLinkContext,
): ContextualAttachTarget | null {
  const { jobId, projectId, clientId, employeeId, equipmentId, serviceCaseId, maintenanceCoverageId } =
    context;
  if (
    !(jobId || projectId || clientId || employeeId || equipmentId || serviceCaseId || maintenanceCoverageId)
  ) {
    return null;
  }

  const targetId =
    jobId ?? projectId ?? clientId ?? employeeId ?? equipmentId ?? serviceCaseId ?? maintenanceCoverageId;
  if (targetId === undefined) return null;

  return {
    targetType: jobId
      ? 'job'
      : projectId
        ? 'project'
        : clientId
          ? 'client'
          : employeeId
            ? 'employee'
            : equipmentId
              ? 'equipment'
              : serviceCaseId
                ? 'service_case'
                : 'maintenance_coverage',
    targetId,
  };
}

export function getContextLink(
  document: OrganizationDocument,
  context: ContextualDocumentLinkContext,
): OrganizationDocument['links'][number] | undefined {
  return document.links.find((link) => {
    if (context.jobId) return link.jobId === context.jobId;
    if (context.projectId) return link.projectId === context.projectId;
    if (context.clientId) return link.clientId === context.clientId;
    if (context.employeeId) return link.employeeId === context.employeeId;
    if (context.requestId) return link.requestId === context.requestId;
    if (context.equipmentId) return link.equipmentId === context.equipmentId;
    if (context.serviceCaseId) return link.serviceCaseId === context.serviceCaseId;
    if (context.maintenanceCoverageId) return link.maintenanceCoverageId === context.maintenanceCoverageId;
    return false;
  });
}

export function getDeleteDescription(document: OrganizationDocument): string {
  const linkCount = document.links.length;

  if (linkCount <= 1) {
    return `„${document.displayName}“ wird aus der gesamten Dokumentenablage in den Papierkorb verschoben. Die Datei ist danach überall nicht mehr verfügbar.`;
  }

  return `„${document.displayName}“ ist mit ${linkCount} Aufträgen, Projekten, Kunden oder Mitarbeitern verknüpft. Das Löschen entfernt die Datei überall aus WerkFlow und verschiebt sie in den Papierkorb – nicht nur auf dieser Seite.`;
}

export function getUnlinkLabel(context: ContextualDocumentLinkContext): string {
  if (context.jobId) return 'Verknüpfung zu diesem Auftrag entfernen';
  if (context.projectId) return 'Verknüpfung zu diesem Projekt entfernen';
  if (context.clientId) return 'Verknüpfung zu diesem Kunden entfernen';
  if (context.employeeId) return 'Verknüpfung zu diesem Mitarbeiter entfernen';
  if (context.requestId) return 'Verknüpfung zu dieser Anfrage entfernen';
  if (context.equipmentId) return 'Verknüpfung zu dieser Anlage entfernen';
  if (context.serviceCaseId) return 'Verknüpfung zu diesem Servicefall entfernen';
  if (context.maintenanceCoverageId) return 'Verknüpfung zu dieser Abdeckung entfernen';
  return 'Verknüpfung entfernen';
}
